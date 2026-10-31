#!/usr/bin/env bash

# Tiles the newest ECMWF run into /home/april/tiles/ecmwf_<run>_<layer>_<step>.pmtiles, which
# pmtiles serve serves at tiles.trailcatalog.org. Runs we already tiled are skipped, so this can
# run hourly. Keep the file names in sync with layer_catalog.ts#ecmwfStepUrl.

set -exo pipefail

out=/home/april/tiles
state=/home/april/ecmwf_run
previous="$(cat "${state}" 2>/dev/null || true)"

CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE=/home/april/frontend_key.json \
    gcloud auth print-access-token \
    | podman login -u oauth2accesstoken --password-stdin us-west1-docker.pkg.dev

work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT
podman run \
    --name ecmwf \
    --pull always \
    --rm \
    --log-driver passthrough \
    --cpu-shares 64 \
    --mount type=bind,source="${work}",target=/tmp \
    --network host \
    us-west1-docker.pkg.dev/trailcatalog/containers/lat_trails_weather:latest \
    --weather_output=/tmp/weather \
    --weather_previous_run="${previous}"

# The importer only writes this file after tiling a new run
if [[ ! -e "${work}/weather/run" ]]; then
  exit 0
fi
run="$(cat "${work}/weather/run")"

# Convert to temporary names and rename, so pmtiles serve never opens a half written archive.
# Clients take wind at step 0 to mean the run is complete, so it goes last.
for mbtiles in "${work}"/weather/*.mbtiles; do
  name="$(basename "${mbtiles}" .mbtiles)"
  if [[ "${name}" == "wind_0" ]]; then
    continue
  fi
  pmtiles convert "${mbtiles}" "${out}/ecmwf_${run}_${name}.pmtiles.partial"
  mv "${out}/ecmwf_${run}_${name}.pmtiles.partial" "${out}/ecmwf_${run}_${name}.pmtiles"
done
pmtiles convert "${work}/weather/wind_0.mbtiles" "${out}/ecmwf_${run}_wind_0.pmtiles.partial"
mv "${out}/ecmwf_${run}_wind_0.pmtiles.partial" "${out}/ecmwf_${run}_wind_0.pmtiles"
echo "${run}" > "${state}"

# Keep the previous run for clients that found it before this one finished. This also clears out
# partial archives from conversions that died.
for archive in "${out}"/ecmwf_*; do
  case "$(basename "${archive}")" in
    "ecmwf_${run}_"* | "ecmwf_${previous}_"*) ;;
    *) rm "${archive}" ;;
  esac
done
