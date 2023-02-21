#!/usr/bin/env bash

set -ex

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

podman run \
    --name 'aria2c' \
    --rm \
    --mount type=bind,source=/mnt/ssd,target=/tmp \
    --network host \
    us-west1-docker.pkg.dev/trailcatalog/containers/aria2c:latest \
    --dir /tmp \
    --max-upload-limit=1K \
    --seed-ratio=0.001 \
    --seed-time=0 \
    https://planet.openstreetmap.org/pbf/planet-latest.osm.pbf.torrent
mv /mnt/ssd/planet-2*.osm.pbf /mnt/ssd/planet-weekly.osm.pbf

podman run \
    --name 'planet_update' \
    --rm \
    --mount type=bind,source=/mnt/ssd,target=/tmp \
    us-west1-docker.pkg.dev/trailcatalog/containers/planet_update:latest \
    /tmp/planet-weekly.osm.pbf \
    --server "https://ftp5.gwdg.de/pub/misc/openstreetmap/planet.openstreetmap.org/replication/day/" \
    --size 8192 \
    -vvv \
    -o /tmp/planet-latest.osm.pbf
rm /mnt/ssd/planet-weekly.osm.pbf

mkdir /mnt/ssd/dems
podman run \
    --name=importer \
    --rm \
    --env DATABASE_URL="postgresql://localhost/trailcatalog?currentSchema=migration_3_faster" \
    --env DATABASE_USERNAME_PASSWORD="trailcatalog:${pg_pwd}" \
    --env JAVA_TOOL_OPTIONS="-XX:InitialHeapSize=24g -XX:MaxHeapSize=24g -XX:MaxMetaspaceSize=1g" \
    --mount type=bind,source=/mnt/ssd,target=/tmp \
    --network host \
    us-west1-docker.pkg.dev/trailcatalog/containers/importer:latest \
    --block_size 4194304 \
    --buffer_size 500000000 \
    --elevation_profile /tmp/elevation_profile.pb \
    --heap_dump_threshold 12048000000 \
    --pbf_path /tmp \
    --source planet
rm -rf /mnt/ssd/dems
