#!/usr/bin/env python3

# Tiles a cycle of FAA Sectional Aeronautical Charts, Terminal Area Charts, and IFR Enroute Low and
# High Altitude Charts into /home/april/tiles/faa_<product>_<cycle>.pmtiles, which pmtiles serve
# serves at tiles.trailcatalog.org. The FAA posts each 56 day cycle about three weeks before it
# takes effect, so this tiles the current cycle and the next one. Cycles already tiled and cycles
# not posted yet are skipped, so this runs daily. Keep the file names in sync with
# layer_catalog.ts#FAA_TILES_URL.
#
# With arguments, tiles one product's current cycle into OUT and keeps nothing else, reading the
# GeoTIFFs from SRC instead of downloading them if it's given:
# faa_charts.py sectional|terminal|enroute_low|enroute_high OUT [SRC]

from dataclasses import dataclass
from datetime import date, timedelta
import io
import multiprocessing
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
import zipfile

import numpy as np
from osgeo import gdal, ogr, osr
from PIL import Image

gdal.UseExceptions()

TILES = Path('/home/april/tiles')
# A cycle the FAA published. Every other cycle starts a multiple of 56 days from it. Keep in sync
# with layer_catalog.ts#FAA_CYCLE_EPOCH.
CYCLE_EPOCH = date(2026, 9, 3)
CYCLE_DAYS = 56
# The previous cycle stays for clients whose clock is behind ours, and the next one is posted early.
KEEP_CYCLES = 3
TILE_SIZE = 512
# Half the width of Web Mercator, in meters
WORLD = 20037508.342789244
# Seattle tiled to 81 MB at 75 and 113 MB as JPEG at the same quality.
WEBP_QUALITY = 75
# A rectangle of chart pixels that runs to the right or bottom edge
EDGE = 1 << 20


def rect(x0: int, y0: int, x1: int, y1: int) -> list[tuple[int, int]]:
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


# The part of each GeoTIFF that is map, in the order we draw them. Each is a box of meridians and
# parallels (west, east, south, north), a ring of lng/lat corners joined by straight lines on the
# chart, or a ring of chart pixels. Cuts are rectangles of chart pixels (x0, y0, x1, y1) to drop:
# insets drawn at another scale over open water, and legend strips that run straight across a
# chart where its curved neat line would let them in.
#
# Insets leave holes where nothing else charts the water under them. Kodiak's is the one hole
# over land, the south end of Kodiak Island.
#
# Western Aleutian Islands East crosses the antimeridian, so it is two pieces or else its Web
# Mercator bounds would span the world.
SECTIONAL_PIECES = [
    ('Seattle', 'box', (-125, -117, 44.5, 49), []),
    ('Great Falls', 'box', (-117, -109, 44.5, 49), []),
    ('Billings', 'box', (-109, -101, 44.5, 49), []),
    ('Twin Cities', 'box', (-101, -93, 44.5, 49), []),
    ('Green Bay', 'box', (-93, -85, 44, 48.25), []),
    ('Lake Huron', 'box', (-85, -77, 44, 48.2), []),
    ('Montreal', 'box', (-77, -69, 44, 48.2), []),
    ('Halifax', 'box', (-69, -61, 44, 48.2), []),
    ('Klamath Falls', 'box', (-125, -117, 40, 44.5), []),
    ('Salt Lake City', 'box', (-117, -109, 40, 44.5), []),
    ('Cheyenne', 'box', (-109, -101, 40, 44.5), []),
    ('Omaha', 'box', (-101, -93, 40, 44.5), []),
    ('Chicago', 'box', (-93, -85, 40, 44), []),
    ('Detroit', 'box', (-85, -77, 40, 44), []),
    ('New York', 'box', (-77, -69, 40, 44), []),
    ('San Francisco', 'box', (-125, -118, 36, 40), []),
    ('Las Vegas', 'box', (-118, -111, 35.6, 40), []),
    ('Denver', 'box', (-111, -104, 35.6, 40), []),
    ('Wichita', 'box', (-104, -97, 36, 40), []),
    ('Kansas City', 'box', (-97, -90, 36, 40), []),
    ('St Louis', 'box', (-91, -84, 36, 40), []),
    ('Cincinnati', 'box', (-85, -78, 36, 40), []),
    # Norfolk
    ('Washington', 'box', (-79, -72, 36, 40), [(14040, 6480, EDGE, 9320)]),
    # The title panel along the west edge, and Los Angeles Basin
    ('Los Angeles', 'box', (-122, -115, 32, 36), [(0, 0, 1560, 6400), (0, 8120, 4720, EDGE)]),
    # The legend strip along the top
    ('Phoenix', 'box', (-116, -109, 31.25, 35.75), [(0, 0, EDGE, 690)]),
    ('Albuquerque', 'box', (-109, -102, 32, 36), []),
    ('Dallas-Ft Worth', 'box', (-102, -95, 32, 36), []),
    ('Memphis', 'box', (-95, -88, 32, 36), []),
    ('Atlanta', 'box', (-88, -81, 32, 36), []),
    ('Charlotte', 'box', (-82, -75, 32, 36), []),
    ('El Paso', 'box', (-109, -103, 28, 32), []),
    ('San Antonio', 'box', (-103, -97, 28, 32), []),
    ('Houston', 'box', (-97, -91, 28, 32), []),
    # Eglin
    ('New Orleans', 'box', (-91, -85, 28, 32), [(10880, 6840, 13560, 10110)]),
    # Jacksonville and Tampa
    ('Jacksonville', 'box', (-85, -79, 28, 32), [(13590, 0, EDGE, 3500), (2220, 7770, 4680, 10670)]),
    ('Brownsville', 'box', (-103, -97, 24, 28), []),
    ('Miami', 'box', (-83, -77, 24, 28), []),
    ('Point Barrow', 'box', (-157, -141, 68, 72), []),
    ('Cape Lisburne', 'box', (-171.5, -157, 68, 72), []),
    # Lavrentiya and Provideniya
    ('Nome', 'box', (-171.5, -158, 64, 68), [(2115, 0, 4260, 3030)]),
    ('Fairbanks', 'box', (-158, -145, 64, 68), []),
    ('Dawson', 'box', (-145, -132, 64, 68), []),
    # The legend strip along the bottom
    ('Bethel', 'box', (-173, -162, 59.5, 64), [(0, 12045, EDGE, EDGE)]),
    ('McGrath', 'box', (-162, -151.5, 60, 64), []),
    ('Anchorage', 'box', (-151.5, -141, 60, 64), []),
    # The legend strip along the bottom
    ('Seward', 'box', (-152.5, -141, 59.25, 61.5), [(0, 6070, EDGE, EDGE)]),
    # Kodiak
    ('Kodiak', 'box', (-162, -151, 56, 60), [(13750, 8470, 16680, EDGE)]),
    # Seward Glacier, Juneau, and the Juneau high density traffic area
    ('Juneau', 'box', (-141, -130.5, 56, 60), [
        (1560, 2676, 4473, 3984), (1587, 3990, 4254, 5886), (1311, 6378, 6399, 10821)]),
    # Ketchikan
    ('Ketchikan', 'box', (-139, -130, 52, 56), [(4620, 885, 7248, 4449)]),
    ('Cold Bay', 'box', (-164, -154.5, 54, 56), []),
    # Pribilof Islands and Dutch Harbor
    ('Dutch Harbor', 'box', (-173, -164, 52, 56), [
        (5019, 322, 7452, 4065), (10164, 303, 13674, 3564)]),
    ('Western Aleutian Islands West', 'box', (169.4, 178.5, 51, 53), []),
    ('Western Aleutian Islands East', 'box', (178.5, 179.9999, 51, 53), []),
    ('Western Aleutian Islands East', 'box', (-179.9999, -172.65, 51, 53), []),
    # The chart is a strip rotated across a white page with legends around it
    ('Hawaiian Islands', 'ring', [
        (-159.72, 23.59), (-154.19, 20.08), (-155.37, 18.41), (-160.90, 21.87)], []),
    # The bottom right corner is folded away under the scale bar
    ('Honolulu Inset', 'pixels', [(80, 60), (5615, 60), (5615, 3200), (4180, 4415), (80, 4415)], []),
    # The legend fills the bottom left
    ('Mariana Islands Inset', 'pixels', [
        (3702, 45), (6070, 45), (6070, 5905), (1480, 5905), (1480, 4600), (2090, 4590),
        (3702, 3090)], []),
    ('Samoan Islands Inset', 'pixels', [
        (40, 50), (6990, 50), (6990, 2515), (8950, 2515), (8950, 3850), (40, 3850)], []),
]

# The map rectangle of each Terminal Area Chart in chart pixels, inside its neat line and above the
# scale bars along its bottom, and cuts as for the sectionals. The flyway planning charts in the
# same zip are left out because they chart routes rather than the ground.
TERMINAL_MAPS = [
    ('Anchorage', (3164, 104, 12036, 5896), []),
    ('Atlanta', (1556, 564, 8956, 7508), []),
    ('Baltimore-Washington', (1620, 192, 12012, 8592), []),
    ('Boston', (1620, 324, 10512, 8736), []),
    ('Charlotte', (1568, 528, 8952, 7376), []),
    ('Chicago', (1552, 544, 7432, 5916), []),
    ('Cincinnati', (1556, 312, 8948, 8596), []),
    ('Cleveland', (1676, 572, 7568, 5948), []),
    ('Colorado Springs', (3156, 68, 11460, 7696), []),
    ('Dallas-Ft Worth', (1616, 136, 11872, 8588), []),
    ('Denver', (1552, 328, 8940, 7208), []),
    ('Detroit', (3088, 88, 10412, 6480), []),
    ('Fairbanks', (3108, 64, 11164, 5756), []),
    ('Houston', (1544, 504, 8968, 7928), []),
    ('Kansas City', (1564, 736, 8944, 7296), []),
    ('Las Vegas', (3112, 604, 10468, 5976), []),
    ('Los Angeles', (4680, 112, 14868, 5884), []),
    ('Memphis', (1680, 564, 9104, 7340), []),
    # The Florida Keys
    ('Miami', (1584, 80, 10456, 8848), [(6350, 7320, EDGE, EDGE), (7280, 6935, EDGE, EDGE)]),
    ('Minneapolis-St Paul', (1608, 564, 7484, 5900), []),
    ('New Orleans', (1560, 524, 8956, 5900), []),
    ('New York', (3068, 576, 11956, 6016), []),
    ('Orlando', (3016, 452, 11748, 7604), []),
    ('Philadelphia', (1740, 644, 7628, 6396), []),
    # The ground elevation key
    ('Phoenix', (3064, 592, 10452, 7388), [(0, 1350, 3385, 2250)]),
    ('Pittsburgh', (1628, 556, 7508, 5928), []),
    ('Portland', (1852, 3100, 5956, 7372), []),
    # San Juan route insets and their notes, over open water north of the islands
    ('Puerto Rico-VI', (1496, 76, 17760, 6032), [(10340, 0, EDGE, 1480)]),
    ('Salt Lake City', (1600, 708, 8992, 7444), []),
    ('San Diego', (4632, 184, 12028, 5984), []),
    ('San Francisco', (3076, 368, 10436, 6512), []),
    ('Seattle', (1684, 556, 7580, 7476), []),
    ('St Louis', (1564, 568, 7452, 5860), []),
    ('Tampa', (1540, 492, 7440, 7376), []),
]
TERMINAL_PIECES = [
    (chart, 'pixels', rect(*bounds), cuts) for chart, bounds, cuts in TERMINAL_MAPS]

# The enroute charts are each a rectangle of map inside a neat line, as chart pixels, with the
# title panel and legends outside it. Charts at several scales overlap, so they're listed coarsest
# first and the larger scale wins where they meet.
#
# Some insets are a larger scale than the chart they sit on and some are a smaller one charting the
# water off its edge. Each is its own GeoTIFF, so we cut it from the chart it sits on and draw it
# where it belongs.
ENROUTE_LOW_PIECES = [
    # Wilmington and Bimini, and Boston to Yarmouth
    ('ENR_L23_WILM_INSET', 'pixels', rect(82, 105, 2852, 7576), []),
    ('ENR_L34_BOST_INSET', 'pixels', [
        (104, 53), (4250, 53), (3905, 1345), (2908, 1878), (104, 2025)], []),
    # Juneau and Vancouver
    ('ENR_AKL01', 'pixels', rect(2205, 273, 21788, 7735), [
        (7743, 4021, 12261, EDGE), (15187, 4216, EDGE, EDGE)]),
    # The chart layout key
    ('ENR_AKL02W', 'pixels', rect(96, 111, 4562, 7576), [(0, 0, 1402, 4019)]),
    ('ENR_AKL02C', 'pixels', rect(89, 106, 4537, 7576), []),
    ('ENR_AKL02E', 'pixels', rect(89, 105, 4539, 7576), []),
    # Right of Fairbanks above and Nome below
    ('ENR_AKL03', 'pixels', [
        (7485, 265), (21796, 265), (21796, 7735), (6085, 7735), (6085, 4084), (7485, 4084)], []),
    # Right of Anchorage, which sits at another scale across a diagonal gap
    ('ENR_AKL04', 'pixels', [
        (10101, 269), (21792, 269), (21792, 7732), (6520, 7732), (6520, 7250), (8942, 3809),
        (10101, 3809)], []),
    ('ENR_L21', 'pixels', rect(2205, 265, 17796, 7736), []),
    ('ENR_L13', 'pixels', rect(2205, 265, 21796, 7736), []),
    ('ENR_AKL01_JNU', 'pixels', rect(85, 153, 4256, 3684), []),
    ('ENR_L09', 'pixels', rect(2205, 265, 21794, 7736), []),
    ('ENR_L11', 'pixels', rect(2205, 265, 21796, 7736), []),
    ('ENR_L12', 'pixels', rect(4203, 263, 21796, 7735), []),
    ('ENR_L14', 'pixels', rect(4205, 265, 21794, 7736), []),
    ('ENR_L32', 'pixels', rect(4205, 265, 23796, 7736), []),
    ('ENR_L10', 'pixels', rect(4205, 265, 21796, 7736), []),
    ('ENR_L31', 'pixels', rect(4205, 265, 21796, 7736), []),
    ('ENR_AKL04_ANC', 'pixels', [
        (205, 268), (7923, 268), (7923, 3630), (6855, 3634), (4360, 7175), (4360, 7731),
        (205, 7731)], []),
    ('ENR_L05', 'pixels', rect(6205, 265, 21796, 7736), []),
    ('ENR_L06N', 'pixels', rect(205, 265, 13796, 7736), []),
    ('ENR_L06S', 'pixels', rect(205, 265, 7796, 7736), []),
    ('ENR_L08', 'pixels', rect(2205, 265, 19796, 7736), []),
    ('ENR_L15', 'pixels', rect(2205, 265, 21796, 7736), []),
    ('ENR_L16', 'pixels', rect(4205, 265, 21796, 7736), []),
    ('ENR_L17', 'pixels', rect(4205, 265, 21796, 7736), []),
    ('ENR_L18', 'pixels', rect(4205, 265, 23796, 7736), []),
    ('ENR_L19', 'pixels', rect(2205, 265, 21796, 7736), []),
    ('ENR_L20', 'pixels', rect(2205, 264, 19796, 7735), []),
    ('ENR_L22', 'pixels', rect(205, 265, 21796, 7736), []),
    # Right of the Wilmington and Bimini inset
    ('ENR_L23', 'pixels', rect(5185, 265, 21796, 7736), []),
    ('ENR_L24', 'pixels', rect(4205, 265, 21796, 7736), []),
    ('ENR_L27', 'pixels', rect(2205, 265, 21796, 7736), []),
    ('ENR_L28', 'pixels', rect(2205, 265, 19796, 7736), []),
    ('ENR_AKL03_FAI', 'pixels', rect(86, 105, 5196, 3754), []),
    ('ENR_AKL03_OME', 'pixels', rect(85, 85, 3796, 3736), []),
    ('ENR_L01', 'pixels', rect(2205, 265, 21792, 7734), []),
    ('ENR_L02', 'pixels', rect(2206, 266, 19796, 7736), []),
    ('ENR_L03', 'pixels', rect(2205, 265, 21796, 7736), []),
    ('ENR_AKL01_VR', 'pixels', rect(109, 145, 6540, 3495), []),
    ('ENR_L04', 'pixels', rect(4205, 265, 21796, 7736), []),
    ('ENR_L07', 'pixels', rect(2204, 265, 21795, 7736), []),
    ('ENR_L25', 'pixels', rect(2204, 265, 19795, 7736), []),
    ('ENR_L26', 'pixels', rect(205, 262, 19796, 7736), []),
    ('ENR_L29', 'pixels', rect(2205, 265, 21796, 7736), []),
    ('ENR_L30', 'pixels', rect(2205, 265, 21796, 7736), []),
    ('ENR_L33', 'pixels', rect(2206, 265, 17796, 7732), []),
    # Left of the Boston and Yarmouth inset
    ('ENR_L34', 'pixels', [
        (205, 260), (21600, 260), (21700, 3120), (22340, 4250), (23798, 4633), (23798, 7731),
        (205, 7731)], []),
    ('ENR_L35', 'pixels', rect(2205, 265, 17794, 7731), []),
    ('ENR_L36', 'pixels', rect(205, 265, 21796, 7732), []),
]
ENROUTE_HIGH_PIECES = [
    # Seattle
    ('ENR_AKH01', 'pixels', rect(2200, 263, 21791, 7736), [(12857, 4274, EDGE, EDGE)]),
    ('ENR_AKH02', 'pixels', rect(2205, 265, 21796, 7736), []),
    ('ENR_AKH01_SEA', 'pixels', rect(129, 127, 8856, 3376), []),
    ('ENR_H01', 'pixels', rect(2205, 205, 23896, 7795), []),
    ('ENR_H02', 'pixels', rect(2105, 205, 21896, 7796), []),
    ('ENR_H03', 'pixels', rect(2206, 105, 23896, 7796), []),
    # The special use airspace table
    ('ENR_H04', 'pixels', rect(205, 104, 21895, 7735), [(0, 3054, 2364, EDGE)]),
    ('ENR_H05', 'pixels', rect(2104, 105, 21895, 7794), []),
    ('ENR_H06', 'pixels', rect(2106, 105, 21896, 7794), []),
    ('ENR_H07', 'pixels', rect(2206, 105, 21896, 7736), []),
    ('ENR_H08', 'pixels', rect(2105, 105, 21796, 7736), []),
    ('ENR_H09', 'pixels', rect(2105, 105, 21796, 7796), []),
    ('ENR_H10', 'pixels', rect(2105, 105, 21796, 7796), []),
    ('ENR_H11', 'pixels', rect(4105, 205, 21796, 7796), []),
    ('ENR_H12', 'pixels', rect(105, 105, 23896, 7796), []),
]


@dataclass(frozen=True)
class Product:
    # Names the archives
    name: str
    title: str
    # The FAA's download directory and the zips in it, without .zip
    section: str
    zip_names: list[str]
    # How the GeoTIFFs in the zips end
    suffix: str
    max_zoom: int
    pieces: list

    @property
    def z_res(self) -> float:
        return 2 * WORLD / (TILE_SIZE << self.max_zoom)


PRODUCTS = [
    # The charts are scanned at 42 m to the pixel. A z11 pixel is 38 m at the equator and smaller
    # toward the poles, so z11 already holds every scanned pixel and z12 would quadruple the tiles
    # for nothing. Keep in sync with layer_catalog.ts's maxZoom for the sectional entry.
    Product('sectional', 'FAA Sectional Aeronautical Charts', 'visual', ['All_Files/Sectional'],
            ' SEC.tif', 11, SECTIONAL_PIECES),
    # Terminal Area Charts are twice the scale, so 21 m to the pixel and z12. Keep in sync with
    # layer_catalog.ts's maxZoom for the terminal entry.
    Product('terminal', 'FAA Terminal Area Charts', 'visual', ['All_Files/Terminal'], ' TAC.tif',
            12, TERMINAL_PIECES),
    # The low charts run 32 to 74 m to the pixel in the lower 48 and the insets, so z11 like the
    # sectionals. Keep in sync with layer_catalog.ts's maxZoom for the enroute_low entry.
    Product('enroute_low', 'FAA IFR Enroute Low Altitude Charts', 'enroute',
            [f'enr_l{i:02d}' for i in range(1, 37)] + [f'enr_akl{i:02d}' for i in range(1, 5)],
            '.tif', 11, ENROUTE_LOW_PIECES),
    # The high charts are 79 to 93 m to the pixel in the lower 48, so z10. Keep in sync with
    # layer_catalog.ts's maxZoom for the enroute_high entry.
    Product('enroute_high', 'FAA IFR Enroute High Altitude Charts', 'enroute',
            [f'enr_h{i:02d}' for i in range(1, 13)] + [f'enr_akh{i:02d}' for i in range(1, 3)],
            '.tif', 10, ENROUTE_HIGH_PIECES),
]


def main():
    if len(sys.argv) > 1:
        product = next(p for p in PRODUCTS if p.name == sys.argv[1])
        out = Path(sys.argv[2])
        out.mkdir(parents=True, exist_ok=True)
        src = Path(sys.argv[3]) if len(sys.argv) > 3 else None
        tile_cycle(product, current_cycle(), out, src)
        return

    current = current_cycle()
    for product in PRODUCTS:
        for cycle in (current, current + timedelta(days=CYCLE_DAYS)):
            if not archive_path(product, TILES, cycle).exists() and is_posted(product, cycle):
                tile_cycle(product, cycle, TILES)

        # Clears out old cycles and the partial archives of runs that died
        archives = sorted(TILES.glob(f'faa_{product.name}_*'))
        keep = set(sorted(p for p in archives if p.suffix == '.pmtiles')[-KEEP_CYCLES:])
        for p in archives:
            if p not in keep:
                p.unlink()


def current_cycle() -> date:
    cycles = (date.today() - CYCLE_EPOCH).days // CYCLE_DAYS
    return CYCLE_EPOCH + timedelta(days=cycles * CYCLE_DAYS)


def archive_path(product: Product, out: Path, cycle: date) -> Path:
    return out / f'faa_{product.name}_{cycle.isoformat()}.pmtiles'


def zip_url(product: Product, cycle: date, zip_name: str) -> str:
    day = cycle.strftime('%m-%d-%Y')
    return f'https://aeronav.faa.gov/{product.section}/{day}/{zip_name}.zip'


def is_posted(product: Product, cycle: date) -> bool:
    # The FAA posts all of a cycle's zips at once.
    url = zip_url(product, cycle, product.zip_names[0])
    request = urllib.request.Request(url, method='HEAD', headers=HEADERS)
    try:
        with urllib.request.urlopen(request):
            return True
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return False
        raise


# aeronav.faa.gov refuses urllib's default user agent.
HEADERS = {'User-Agent': 'trails.lat tiler (https://trails.lat)'}


def tile_cycle(product: Product, cycle: date, out: Path, src: Path | None = None):
    archive = archive_path(product, out, cycle)
    work = Path(tempfile.mkdtemp(dir='/var/tmp', prefix=f'faa_{product.name}_'))
    try:
        if src is None:
            src = work
            for zip_name in product.zip_names:
                url = zip_url(product, cycle, zip_name)
                print(f'Downloading {url}', flush=True)
                download = work / 'charts.zip'
                request = urllib.request.Request(url, headers=HEADERS)
                with urllib.request.urlopen(request) as r, open(download, 'wb') as f:
                    shutil.copyfileobj(r, f, length=1 << 20)
                with zipfile.ZipFile(download) as z:
                    for name in z.namelist():
                        if name.endswith(product.suffix):
                            z.extract(name, work)
                download.unlink()

        pieces = [
            warp_piece(product, src, work, i, *piece) for i, piece in enumerate(product.pieces)]
        mbtiles = work / 'charts.mbtiles'
        write_tiles(product, pieces, mbtiles)
        # Converted to a temporary name and renamed, so pmtiles serve never opens a half written
        # archive
        partial = archive.with_name(archive.name + '.partial')
        subprocess.run(['pmtiles', 'convert', str(mbtiles), str(partial)], check=True)
        partial.rename(archive)
    finally:
        shutil.rmtree(work)


def warp_piece(
        product: Product, src_dir: Path, work: Path, i: int, chart: str, kind: str, shape,
        cuts) -> Path:
    """Writes a VRT of the piece warped onto the max zoom grid, transparent outside its map."""
    src = gdal.Open(str(next(src_dir.rglob(f'{chart}{product.suffix}'))))
    srs = osr.SpatialReference(wkt=src.GetProjection())
    srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    transform = src.GetGeoTransform()

    if kind == 'pixels':
        ring = [gdal.ApplyGeoTransform(transform, x, y) for x, y in shape]
    else:
        lng_lat = osr.SpatialReference()
        lng_lat.ImportFromEPSG(4326)
        lng_lat.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
        to_chart = osr.CoordinateTransformation(lng_lat, srs)
        corners = box_ring(*shape) if kind == 'box' else shape
        ring = [to_chart.TransformPoint(lng, lat)[:2] for lng, lat in corners]
    cutline = polygon(ring)
    for x0, y0, x1, y1 in cuts:
        x1 = min(x1, src.RasterXSize)
        y1 = min(y1, src.RasterYSize)
        cutline = cutline.Difference(
            polygon([gdal.ApplyGeoTransform(transform, x, y) for x, y in rect(x0, y0, x1, y1)]))

    # The VFR charts are paletted, so they're expanded before resampling blends neighbors. The
    # enroute charts are already RGB.
    rgb = work / f'{i}_rgb.vrt'
    paletted = src.GetRasterBand(1).GetColorTable() is not None
    gdal.Translate(str(rgb), src, format='VRT', rgbExpand='rgb' if paletted else None)
    warped = work / f'{i}_3857.vrt'
    gdal.Warp(
        str(warped),
        str(rgb),
        format='VRT',
        dstSRS='EPSG:3857',
        xRes=product.z_res,
        yRes=product.z_res,
        targetAlignedPixels=True,
        resampleAlg='cubic',
        cutlineWKT=cutline.ExportToWkt(),
        cutlineSRS=srs.ExportToWkt(),
        cropToCutline=True,
        dstAlpha=True)
    return warped


def box_ring(west: float, east: float, south: float, north: float) -> list[tuple[float, float]]:
    # Parallels are arcs on the chart, so each edge gets a vertex every 0.05 degrees.
    def edge(a, b):
        steps = max(1, int(max(abs(b[0] - a[0]), abs(b[1] - a[1])) / 0.05))
        return [(a[0] + (b[0] - a[0]) * k / steps, a[1] + (b[1] - a[1]) * k / steps)
                for k in range(steps)]
    corners = [(west, south), (east, south), (east, north), (west, north)]
    return [p for a, b in zip(corners, corners[1:] + corners[:1]) for p in edge(a, b)]


def polygon(points) -> ogr.Geometry:
    ring = ogr.Geometry(ogr.wkbLinearRing)
    for x, y in list(points) + [points[0]]:
        ring.AddPoint_2D(x, y)
    poly = ogr.Geometry(ogr.wkbPolygon)
    poly.AddGeometry(ring)
    return poly


def write_tiles(product: Product, pieces: list[Path], mbtiles: Path):
    """Writes the max zoom from the pieces and each zoom out to z0 from the one under it."""
    db = sqlite3.connect(mbtiles)
    db.executescript("""
        CREATE TABLE metadata (name TEXT, value TEXT);
        CREATE TABLE tiles (
            zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB);
        CREATE UNIQUE INDEX tile_index ON tiles (zoom_level, tile_column, tile_row);
    """)
    db.executemany('INSERT INTO metadata VALUES (?, ?)', [
        ('name', product.title),
        ('format', 'webp'),
        ('type', 'baselayer'),
        ('minzoom', '0'),
        ('maxzoom', str(product.max_zoom)),
        ('bounds', '-180,-85.0511,180,85.0511'),
        ('attribution', 'FAA Aeronautical Information Services'),
    ])

    # Which pieces cover each max zoom tile
    covering: dict[tuple[int, int], list[int]] = {}
    for i, path in enumerate(pieces):
        x0, y0, x1, y1 = pixel_bounds(gdal.Open(str(path)), product.z_res)
        for y in range(y0 // TILE_SIZE, (y1 - 1) // TILE_SIZE + 1):
            for x in range(x0 // TILE_SIZE, (x1 - 1) // TILE_SIZE + 1):
                covering.setdefault((x, y), []).append(i)
    # Rows of neighboring tiles go to the same worker so GDAL's block cache keeps the source
    # scanlines they share.
    keys = sorted(covering, key=lambda k: (k[1], k[0]))
    batches = [[(k, covering[k]) for k in keys[i:i + 64]] for i in range(0, len(keys), 64)]
    print(f'Tiling {len(keys)} z{product.max_zoom} tiles from {len(pieces)} pieces', flush=True)

    with multiprocessing.Pool(
            initializer=open_pieces, initargs=(pieces, product.z_res)) as pool:
        written = set()
        for batch in pool.imap_unordered(render_batch, batches):
            for (x, y), data in batch:
                insert(db, product.max_zoom, x, y, data)
                written.add((x, y))
        db.commit()

        for z in range(product.max_zoom - 1, -1, -1):
            parents = sorted({(x // 2, y // 2) for x, y in written})
            print(f'Tiling {len(parents)} z{z} tiles', flush=True)
            jobs = [(p, children(db, z + 1, p)) for p in parents]
            written = set()
            for (x, y), data in pool.imap_unordered(render_parent, jobs, chunksize=16):
                if data is not None:
                    insert(db, z, x, y, data)
                    written.add((x, y))
            db.commit()
    db.close()


def pixel_bounds(ds, z_res: float) -> tuple[int, int, int, int]:
    """The dataset's extent in pixels of the max zoom grid, which it is aligned to."""
    ox, _, _, oy, _, _ = ds.GetGeoTransform()
    x0 = round((ox + WORLD) / z_res)
    y0 = round((WORLD - oy) / z_res)
    return x0, y0, x0 + ds.RasterXSize, y0 + ds.RasterYSize


def insert(db: sqlite3.Connection, z: int, x: int, y: int, data: bytes):
    # MBTiles counts rows from the bottom
    db.execute(
        'INSERT INTO tiles VALUES (?, ?, ?, ?)', (z, x, (1 << z) - 1 - y, sqlite3.Binary(data)))


def children(db: sqlite3.Connection, z: int, parent: tuple[int, int]) -> list[bytes | None]:
    px, py = parent
    out = []
    for dy in (0, 1):
        for dx in (0, 1):
            x, y = 2 * px + dx, 2 * py + dy
            row = db.execute(
                'SELECT tile_data FROM tiles WHERE zoom_level = ? AND tile_column = ? AND '
                    + 'tile_row = ?',
                (z, x, (1 << z) - 1 - y)).fetchone()
            out.append(row[0] if row else None)
    return out


# Each worker's open pieces and their pixel bounds
_pieces: list[tuple[gdal.Dataset, tuple[int, int, int, int]]] = []


def open_pieces(paths: list[Path], z_res: float):
    gdal.SetCacheMax(512 << 20)
    for path in paths:
        ds = gdal.Open(str(path))
        _pieces.append((ds, pixel_bounds(ds, z_res)))


def render_batch(batch):
    out = []
    for (x, y), indices in batch:
        data = render_tile(x, y, indices)
        if data is not None:
            out.append(((x, y), data))
    return out


def render_tile(x: int, y: int, indices: list[int]) -> bytes | None:
    """Draws the pieces over each other in order, or None if they leave the tile empty."""
    tile = np.zeros((TILE_SIZE, TILE_SIZE, 4), dtype=np.float32)
    tx, ty = x * TILE_SIZE, y * TILE_SIZE
    for i in indices:
        ds, (x0, y0, x1, y1) = _pieces[i]
        # The overlap of the tile and the piece, in grid pixels
        ax, ay = max(tx, x0), max(ty, y0)
        bx, by = min(tx + TILE_SIZE, x1), min(ty + TILE_SIZE, y1)
        if ax >= bx or ay >= by:
            continue
        rgba = ds.ReadAsArray(ax - x0, ay - y0, bx - ax, by - ay).transpose(1, 2, 0)
        rgba = rgba.astype(np.float32) / 255
        under = tile[ay - ty:by - ty, ax - tx:bx - tx]
        alpha = rgba[..., 3:]
        under[..., :3] = rgba[..., :3] * alpha + under[..., :3] * (1 - alpha)
        under[..., 3:] = alpha + under[..., 3:] * (1 - alpha)
    return encode(tile)


def render_parent(job) -> tuple[tuple[int, int], bytes | None]:
    parent, datas = job
    quad = np.zeros((2 * TILE_SIZE, 2 * TILE_SIZE, 4), dtype=np.float32)
    for k, data in enumerate(datas):
        if data is None:
            continue
        child = np.asarray(Image.open(io.BytesIO(data)).convert('RGBA'), dtype=np.float32) / 255
        dy, dx = divmod(k, 2)
        quad[dy * TILE_SIZE:(dy + 1) * TILE_SIZE, dx * TILE_SIZE:(dx + 1) * TILE_SIZE] = child
    # Averaged with premultiplied alpha, or else transparent pixels darken the edges of charts
    quad[..., :3] *= quad[..., 3:]
    tile = quad.reshape(TILE_SIZE, 2, TILE_SIZE, 2, 4).mean(axis=(1, 3))
    covered = tile[..., 3:] > 0
    tile[..., :3] = np.where(covered, tile[..., :3] / np.where(covered, tile[..., 3:], 1), 0)
    return parent, encode(tile)


def encode(tile: np.ndarray) -> bytes | None:
    """Encodes a float RGBA tile as WebP, or None if it's entirely transparent."""
    rgba = np.clip(np.rint(tile * 255), 0, 255).astype(np.uint8)
    alpha = rgba[..., 3]
    if not alpha.any():
        return None
    if alpha.min() == 255:
        image = Image.fromarray(rgba[..., :3], 'RGB')
    else:
        image = Image.fromarray(rgba, 'RGBA')
    out = io.BytesIO()
    image.save(out, format='WEBP', quality=WEBP_QUALITY)
    return out.getvalue()


if __name__ == '__main__':
    main()
