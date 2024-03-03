#!/usr/bin/env bash

set -ex

CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE=/home/april/frontend_key.json \
    gcloud auth print-access-token \
    | podman login -u oauth2accesstoken --password-stdin us-west1-docker.pkg.dev

secrets="$(CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE=/home/april/frontend_key.json \
    gcloud \
    secrets \
    versions \
    access \
    latest \
    --project trailcatalog \
    --secret trails_lat \
    --quiet)"

cookie_secret="$(echo "${secrets}" | jq -r '.cookie_secret')"
google_cid="$(echo "${secrets}" | jq -r '.google_client_id')"
google_secret="$(echo "${secrets}" | jq -r '.google_client_secret')"
pg_user="$(echo "${secrets}" | jq -r '.database_username')"
pg_pwd="$(echo "${secrets}" | jq -r '.database_password')"

podman run \
    --name trails-lat-frontend \
    --pull always \
    --rm \
    --env COOKIE_SECRET="${cookie_secret}" \
    --env OAUTH2_GOOGLE_CLIENT_ID="${google_cid}" \
    --env OAUTH2_GOOGLE_SECRET="${google_secret}" \
    --env PGHOST='127.0.0.1' \
    --env PGPORT='5432' \
    --env PGDATABASE='trails_lat' \
    --env PGPASSWORD="${pg_pwd}" \
    --env PGUSER="${pg_user}" \
    --network host \
    us-west1-docker.pkg.dev/trailcatalog/containers/lat_trails_frontend:latest \
    /app/serve.sh \
    --database_username_password="${pg_user}:${pg_pwd}" \
    --database_url "postgresql://127.0.0.1/trails_lat" # TODO(april): specify schema?
