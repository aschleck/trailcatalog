#!/usr/bin/env bash

# Updates the aviation collections from openAIP and NOAA.

set -exo pipefail

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
    --name aviation_vectors \
    --pull always \
    --rm \
    --log-driver passthrough \
    --cgroups split \
    --network host \
    us-west1-docker.pkg.dev/trailcatalog/containers/lat_trails_aviation_vectors:latest \
    --database_username_password="${pg_user}:${pg_pwd}" \
    --database_url "postgresql://127.0.0.1/trails_lat"
