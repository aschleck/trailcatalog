#!/usr/bin/env nix-shell
#! nix-shell -i bash -p curl jq pmtiles

# Pulls z13 and z14 out of each of mapterhorn's regional archives into /mnt/horse/mapterhorn, next
# to planet.pmtiles, for MapterhornResolver. Rerunning skips the archives already extracted.

set -exo pipefail

# Keep in sync with MapterhornResolver#MAX_ZOOM.
max_zoom=14
out=/mnt/horse/mapterhorn

mkdir -p "${out}"
curl -sf https://download.mapterhorn.com/download_urls.json \
    | jq -r '.items[] | select(.name != "planet.pmtiles") | .url' \
    | while read -r url; do
  name="$(basename "${url}")"
  if [[ -e "${out}/${name}" ]]; then
    continue
  fi
  # Extracted beside the destination so that an interrupted run never leaves a partial archive
  # under a name we would skip
  pmtiles extract "${url}" "${out}/${name}.partial" --maxzoom="${max_zoom}" --quiet
  mv "${out}/${name}.partial" "${out}/${name}"
done
