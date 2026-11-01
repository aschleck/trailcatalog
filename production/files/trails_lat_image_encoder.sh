#!/usr/bin/env bash

# Re-encodes the original image on stdin as WebP at each of wire Images.kt#IMAGE_SIZES and writes
# to stdout:
#
#   <thumbnail bytes> <display bytes> <metadata bytes>\n<thumbnail><display><metadata>
#
# where metadata is exiftool's JSON for the EXIF fields copied into display.
#
# Every original is hostile. In production systemd runs one of these per connection with no
# network, no capabilities, and limits on memory and time, see the trails-lat-image-encoder socket
# in configuration.nix. Those limits are what stop a decompression bomb. On failure it exits
# nonzero and writes nothing to stdout.

set -euo pipefail

work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT
cd "${work}"
cat > original

# https://www.libvips.org/API/current/func.block_untrusted_set.html
export VIPS_BLOCK_UNTRUSTED=1

loader="$(vipsheader -f vips-loader original)"
case "${loader}" in
  gifload|heifload|jpegload|pngload|tiffload|uhdrload|webpload) ;;
  *) echo "Refusing ${loader}" >&2; exit 1 ;;
esac

# thumbnail rotates the image upright according to its EXIF orientation, and keep=none writes no
# metadata. The thumbnail comes from the display size so we decode the original only once.
vips thumbnail original 'display.webp[Q=85,keep=none]' 2048 --size down
vips thumbnail display.webp 'thumbnail.webp[Q=85,keep=none]' 128 --size down

# Capture time, camera, lens, exposure, credit, and location, which the point shows anyway. Serial
# numbers, owner names, and maker notes stay behind because they identify the camera, and
# Orientation because thumbnail already turned the pixels upright.
tags=(
  -DateTimeOriginal -SubSecTimeOriginal -OffsetTimeOriginal
  -Make -Model -LensMake -LensModel
  -FocalLength -FocalLengthIn35mmFormat -FNumber -ExposureTime -ISO
  -Artist -Copyright
  -GPS:all
)
exiftool -q -q -overwrite_original -TagsFromFile original "${tags[@]}" display.webp
exiftool -j -n "${tags[@]}" display.webp > metadata.json

# wc pads its count with spaces on a Mac, and arithmetic strips them.
sizes=()
for part in thumbnail.webp display.webp metadata.json; do
  sizes+=("$(( $(wc -c < "${part}") ))")
done
echo "${sizes[*]}"
cat thumbnail.webp display.webp metadata.json
