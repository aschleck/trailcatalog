#!/usr/bin/env bash

set -ex

podman rm -f trails-lat-frontend || true

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

tc_pwd="$(CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE=/home/april/frontend_key.json \
    gcloud \
    secrets \
    versions \
    access \
    latest \
    --project trailcatalog \
    --secret db-authorization \
    --quiet \
    | sed 's/^[^:]*://' | tail -n 1)"

cookie_secret="$(echo "${secrets}" | jq -r '.cookie_secret')"
# See frontend/oidc.ts#LoginConfig. We leave out a provider the secret has no client ID for.
login_providers="$(echo "${secrets}" | jq -c '{
  apple: {
    client_id: .apple_client_id,
    team_id: .apple_team_id,
    key_id: .apple_key_id,
    private_key: .apple_private_key
  },
  google: {
    client_id: .google_client_id,
    client_secret: .google_client_secret
  },
  osm: {
    client_id: .osm_client_id,
    client_secret: .osm_client_secret
  }
} | with_entries(select(.value.client_id != null))')"
pg_user="$(echo "${secrets}" | jq -r '.database_username')"
pg_pwd="$(echo "${secrets}" | jq -r '.database_password')"

podman run \
    --name trails-lat-frontend \
    --pull always \
    --rm \
    --log-driver passthrough \
    --cgroups split \
    --env COOKIE_SECRET="${cookie_secret}" \
    --env LOGIN_PROVIDERS="${login_providers}" \
    --env PGHOST='127.0.0.1' \
    --env PGPORT='5432' \
    --env PGDATABASE='trails_lat' \
    --env PGPASSWORD="${pg_pwd}" \
    --env PGUSER="${pg_user}" \
    --network host \
    us-west1-docker.pkg.dev/trailcatalog/containers/lat_trails_frontend:latest \
    /app/serve.sh \
    --database_username_password="${pg_user}:${pg_pwd}" \
    --database_url "postgresql://127.0.0.1/trails_lat" \
    --trailcatalog_database_username_password="trailcatalog:${tc_pwd}" \
    --trailcatalog_database_url "postgresql://127.0.0.1/trailcatalog"
