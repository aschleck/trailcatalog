#!/usr/bin/env bash

set -e
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
echo "CREATE ROLE trailcatalog LOGIN ENCRYPTED PASSWORD '${pg_pwd}';" | sudo su postgres -c psql
echo "CREATE DATABASE trailcatalog WITH OWNER trailcatalog;" | sudo su postgres -c psql
echo "CREATE EXTENSION pg_trgm;" | sudo su postgres -c psql -- -d trailcatalog

# run reshape

pg_pwd="$(CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE=/home/april/frontend_key.json \
    gcloud \
    secrets \
    versions \
    access \
    latest \
    --project trailcatalog \
    --secret trails_lat \
    --quiet \
    | jq -r '.database_password')"
echo "CREATE ROLE trails_lat LOGIN ENCRYPTED PASSWORD '${pg_pwd}';" | sudo su postgres -c psql
echo "CREATE DATABASE trails_lat WITH OWNER trails_lat;" | sudo su postgres -c psql
echo "CREATE EXTENSION pg_trgm;" | sudo su postgres -c psql -- -d trails_lat

# run reshape
