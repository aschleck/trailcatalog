#!/usr/bin/env bash

# Tiles a day of SNODAS into /home/april/tiles/snodas_<day>.pmtiles, which pmtiles serve serves at
# tiles.trailcatalog.org. The day defaults to today in UTC. Days already tiled and days NSIDC hasn't
# posted yet are skipped, so this runs hourly. Keep the file name in sync with
# viewer_controller.ts#SNODAS_URL.

set -exo pipefail

day="${1:-$(date -u +%F)}"
out=/home/april/tiles
archive="${out}/snodas_${day}.pmtiles"
if [[ -e "${archive}" ]]; then
  exit 0
fi

# NSIDC posts each day at 13:00 UTC, or 14:00 while the US is on standard time, so most runs find
# nothing yet. Keep in sync with Snodas.kt#ARCHIVE_URL.
tar="$(LC_ALL=C date -u -d "${day}" +%Y/%m_%b/SNODAS_%Y%m%d).tar"
if ! curl -sfI "https://noaadata.apps.nsidc.org/NOAA/G02158/masked/${tar}" > /dev/null; then
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
    --log-driver passthrough \
    --mount type=bind,source="${work}",target=/tmp \
    --network host \
    us-west1-docker.pkg.dev/trailcatalog/containers/lat_trails_snodas:latest \
    --date="${day}" \
    --output=/tmp/snodas.mbtiles
# Convert to a temporary name and rename, so pmtiles serve never opens a half written archive
pmtiles convert "${work}/snodas.mbtiles" "${archive}.partial"
mv "${archive}.partial" "${archive}"

# Keep the two newest days, so clients that found yesterday's keep working until their hourly
# check finds today's. This also clears out partial archives from conversions that died. Keep in
# sync with viewer_controller.ts#SNODAS_LOOKBACK_DAYS.
keep="$(find "${out}" -maxdepth 1 -name 'snodas_*.pmtiles' | sort | tail -n 2)"
for old in "${out}"/snodas_*; do
  if ! grep -qxF "${old}" <<< "${keep}"; then
    rm "${old}"
  fi
done
