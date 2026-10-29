#!/usr/bin/env bash

set -exo pipefail

# gcloud hands back its cached access token, which can expire partway through the run, so every
# pull logs in again first.
registry_login() {
  CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE=/home/april/frontend_key.json \
      gcloud auth print-access-token \
      | podman login -u oauth2accesstoken --password-stdin us-west1-docker.pkg.dev
}

set +x
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
export DATABASE_USERNAME_PASSWORD="trailcatalog:${pg_pwd}"
set -x

# The planet is kept between runs and brought forward with the daily diffs. Each update renames over
# it, so its mtime is the last successful update, and planet_update refuses a file more than 90
# days old.
planet=/mnt/horse/planet-latest.osm.pbf
if [[ -z "$(find "${planet}" -mtime -60 2>/dev/null)" ]]; then
  rm -f "${planet}"
  registry_login
  podman run \
      --name 'aria2c' \
      --pull always \
      --rm \
      --log-driver passthrough \
      --mount type=bind,source=/mnt/horse,target=/tmp \
      --network host \
      us-west1-docker.pkg.dev/trailcatalog/containers/aria2c:latest \
      --dir /tmp \
      --max-upload-limit=1K \
      --seed-ratio=0.001 \
      --seed-time=0 \
      https://planet.openstreetmap.org/pbf/planet-latest.osm.pbf.torrent
  rm -f /mnt/horse/planet-*.torrent
  mv /mnt/horse/planet-2*.osm.pbf "${planet}"
fi

# Without -o it writes beside the input and renames over it only on success. 64 CPU shares come out
# as a cgroup weight of 12 against the frontends' 100, so this and the importer only take cores the
# frontends aren't using.
registry_login
podman run \
    --name 'planet_update' \
    --pull always \
    --rm \
    --log-driver passthrough \
    --cpu-shares 64 \
    --mount type=bind,source=/mnt/horse,target=/tmp \
    --network host \
    us-west1-docker.pkg.dev/trailcatalog/containers/planet_update:latest \
    /tmp/planet-latest.osm.pbf \
    --server "https://planet.maps.mail.ru/replication/day/" \
    --size 8192 \
    -vvv

# /tmp in the container is /mnt/horse, so the flight recording outlives the container.
registry_login
podman run \
    --name=importer \
    --pull always \
    --rm \
    --log-driver passthrough \
    --cpu-shares 64 \
    --env DATABASE_URL="postgresql://localhost/trailcatalog" \
    --env DATABASE_USERNAME_PASSWORD \
    --env JAVA_TOOL_OPTIONS="-XX:InitialHeapSize=24g -XX:MaxHeapSize=40g -XX:MaxMetaspaceSize=1g -XX:StartFlightRecording=filename=/tmp/import.jfr,settings=profile,dumponexit=true,maxsize=4g" \
    --mount type=bind,source=/mnt/horse,target=/tmp \
    --network host \
    us-west1-docker.pkg.dev/trailcatalog/containers/importer:latest \
    --block_size 4194304 \
    --buffer_size 500000000 \
    --elevation_profile /tmp/elevation_profile.pb \
    --elevation_source MAPTERHORN \
    --heap_dump_threshold 8048000000 \
    --parallelism 10 \
    --mapterhorn_dir /tmp/mapterhorn \
    --pbfs /tmp/planet-latest.osm.pbf \
    | tee /mnt/horse/import_log.txt
