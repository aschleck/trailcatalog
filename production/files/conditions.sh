#!/usr/bin/env bash

# Updates the conditions collections from their sources. PYAVACORE is a checkout of pyAvaCore, see
# configuration.nix.

set -exo pipefail

# pyAvaCore logs and moves on when a warning service fails, so one service being down doesn't stop
# the rest.
work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT
(cd "${PYAVACORE}" && python3 -m avacore --output "${work}/avalanche" --log "${work}/logs")

CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE=/home/april/frontend_key.json \
    gcloud auth print-access-token \
    | podman login -u oauth2accesstoken --password-stdin us-west1-docker.pkg.dev

# The secrets reach the container as flags on the podman command line, so xtrace stays off
# through it or else it prints them into the journal.
set +x
secrets="$(CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE=/home/april/frontend_key.json \
    gcloud \
    secrets \
    versions \
    access \
    latest \
    --project trailcatalog \
    --secret trails_lat \
    --quiet)"
pg_user="$(echo "${secrets}" | jq -r '.database_username')"
pg_pwd="$(echo "${secrets}" | jq -r '.database_password')"

podman run \
    --name conditions \
    --pull always \
    --rm \
    --mount type=bind,source="${work}/avalanche",target=/avalanche,readonly \
    --network host \
    us-west1-docker.pkg.dev/trailcatalog/containers/lat_trails_conditions:latest \
    --avalanche_bulletins=/avalanche \
    --database_username_password="${pg_user}:${pg_pwd}" \
    --database_url "postgresql://127.0.0.1/trails_lat"
