#!/usr/bin/env bash

set -ex

podman rm -f trailcatalog-frontend || true

CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE=/home/april/frontend_key.json \
    gcloud auth print-access-token \
    | podman login -u oauth2accesstoken --password-stdin us-west1-docker.pkg.dev

pg_pwd="$(CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE=/home/april/frontend_key.json \
    gcloud \
    secrets \
    versions \
    access \
    latest \
    --project trailcatalog \
    --secret db-authorization \
    --quiet \
    | sed 's/^[^:]*://' | tail -n 1)"

#--env DATABASE_URL="postgresql://localhost/trailcatalog?currentSchema=migration_2_search" \
podman run \
    --name trailcatalog-frontend \
    --pull always \
    --rm \
    --env DATABASE_URL="postgresql://localhost/trailcatalog" \
    --env DATABASE_USERNAME_PASSWORD="trailcatalog:${pg_pwd}" \
    --network host \
    us-west1-docker.pkg.dev/trailcatalog/containers/frontend:latest
