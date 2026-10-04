#!/usr/bin/env bash

# Tiles a day of SNODAS into /home/april/tiles/snodas_<day>.pmtiles, which pmtiles serve serves at
# tiles.trailcatalog.org. The day defaults to today in UTC. We skip days that are already tiled, so
# a later run can retry a day NSIDC published late. Keep the file name in sync with
# viewer_controller.ts#SNODAS_URL.

set -exo pipefail

day="${1:-$(date -u +%F)}"
out=/home/april/tiles
archive="${out}/snodas_${day}.pmtiles"
if [[ -e "${archive}" ]]; then
  exit 0
fi

CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE=/home/april/frontend_key.json \
    gcloud auth print-access-token \
    | podman login -u oauth2accesstoken --password-stdin us-west1-docker.pkg.dev

work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT
podman run \
    --name snodas \
    --pull always \
    --rm \
    --mount type=bind,source="${work}",target=/tmp \
    --network host \
    us-west1-docker.pkg.dev/trailcatalog/containers/lat_trails_snodas:latest \
    --date="${day}" \
    --output=/tmp/snodas.mbtiles
# Convert to a temporary name and rename, so pmtiles serve never opens a half written archive
pmtiles convert "${work}/snodas.mbtiles" "${archive}.partial"
mv "${archive}.partial" "${archive}"
