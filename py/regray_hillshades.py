# Rewrites a hillshade archive from shade-in-alpha tiles to gray tiles whose alpha only marks nodata.
# See Hillshader.kt#main and raster_loader.ts#alphaFromShade.
#
# usage: python regray_hillshades.py in.pmtiles out.pmtiles [quality]

import io
import multiprocessing
import os
import sys
import tempfile

import numpy as np
from PIL import Image

from pmtiles.reader import MmapSource, Reader, all_tiles
from pmtiles.tile import zxy_to_tileid
from pmtiles.writer import Writer


QUALITY = int(sys.argv[3]) if len(sys.argv) > 3 else 75


def regray(data):
    rgba = np.asarray(Image.open(io.BytesIO(data)).convert('RGBA'))
    alpha = rgba[:, :, 3].astype(np.int32)
    # The old tiles stored alpha = min(255, 275 - gray) losslessly, so alpha gives the gray back
    # exactly everywhere but the brightest 20 levels, where we fall back to the lossy gray.
    gray = np.where(alpha < 255, np.minimum(275 - alpha, 255), np.clip(rgba[:, :, 0], 1, 20))
    gray = gray.astype(np.uint8)
    nodata = alpha == 0
    out = io.BytesIO()
    if nodata.any():
        gray[nodata] = 0
        image = np.dstack([gray, gray, gray, np.where(nodata, 0, 255).astype(np.uint8)])
        Image.fromarray(image, 'RGBA').save(out, 'WEBP', quality=QUALITY)
    else:
        image = np.dstack([gray, gray, gray])
        Image.fromarray(image, 'RGB').save(out, 'WEBP', quality=QUALITY)
    return out.getvalue()


def convert(item):
    (z, x, y), data = item
    return zxy_to_tileid(z, x, y), len(data), regray(data)


def main():
    source, destination = sys.argv[1], sys.argv[2]
    # Writer spools tile data to a temporary file, which is as big as the output
    tempfile.tempdir = os.path.dirname(os.path.abspath(destination))
    with open(source, 'rb') as f:
        get_bytes = MmapSource(f)
        reader = Reader(get_bytes)
        header = reader.header()
        metadata = reader.metadata()
        before = 0
        after = 0
        count = 0
        with open(destination, 'wb') as out, multiprocessing.Pool() as pool:
            writer = Writer(out)
            # imap keeps the archive's order, so the output stays clustered
            for tile_id, size, data in pool.imap(convert, all_tiles(get_bytes), chunksize=64):
                writer.write_tile(tile_id, data)
                before += size
                after += len(data)
                count += 1
                if count % 10000 == 0:
                    print(f'{count} tiles, {before >> 20} MB to {after >> 20} MB', flush=True)
            writer.finalize(header, metadata)
        print(f'{count} tiles, {before >> 20} MB to {after >> 20} MB')


if __name__ == '__main__':
    main()
