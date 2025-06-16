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
    --pull always \
    --rm \
    --mount type=bind,source=/mnt/horse,target=/tmp \
    --network host \
    us-west1-docker.pkg.dev/trailcatalog/containers/aria2c:latest \
    --dir /tmp \
    --max-upload-limit=1K \
    --seed-ratio=0.001 \
    --seed-time=0 \
    https://planet.openstreetmap.org/pbf/planet-latest.osm.pbf.torrent
rm -f /mnt/horse/planet-*.torrent
mv /mnt/horse/planet-2*.osm.pbf /mnt/horse/planet-weekly.osm.pbf

rm -f /mnt/horse/planet-latest.osm.pbf
podman run \
    --name 'planet_update' \
    --pull always \
    --rm \
    --mount type=bind,source=/mnt/horse,target=/tmp \
    --network host \
    us-west1-docker.pkg.dev/trailcatalog/containers/planet_update:latest \
    /tmp/planet-weekly.osm.pbf \
    --server "https://planet.maps.mail.ru/replication/day/" \
    --size 8192 \
    -vvv \
    -o /tmp/planet-latest.osm.pbf
rm -f /mnt/horse/planet-weekly.osm.pbf

CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE=/home/april/frontend_key.json \
    gcloud auth print-access-token \
    | podman login -u oauth2accesstoken --password-stdin us-west1-docker.pkg.dev

mkdir -p /mnt/horse/dems
podman run \
    --name=importer \
    --pull always \
    --rm \
    --env DATABASE_URL="postgresql://localhost/trailcatalog" \
    --env DATABASE_USERNAME_PASSWORD="trailcatalog:${pg_pwd}" \
    --env JAVA_TOOL_OPTIONS="-XX:InitialHeapSize=24g -XX:MaxHeapSize=40g -XX:MaxMetaspaceSize=1g" \
    --mount type=bind,source=/mnt/horse,target=/tmp \
    --network host \
    us-west1-docker.pkg.dev/trailcatalog/containers/importer:latest \
    --block_size 4194304 \
    --buffer_size 500000000 \
    --elevation_profile /tmp/elevation_profile.pb \
    --heap_dump_threshold 8048000000 \
    --pbf_path /tmp \
    --source planet | tee /mnt/horse/import_log.txt
rm -rf /mnt/horse/dems /mnt/horse/planet-latest.osm.pbf
