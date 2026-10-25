# Splits the contour archive into one archive per unit, with each tile gzipped so that the tile
# server sends it compressed. A tile holds a `contour` layer in meters and a `contour_ft` layer in
# feet, and the map only draws one of them. Below zoom 14 a tile also drops the lines its unit's
# style never draws at that zoom.
#
# usage: python split_contours.py contours.pmtiles contours_m.pmtiles contours_ft.pmtiles

import array
import gzip
import json
import multiprocessing
import sys

from pmtiles.reader import MmapSource, Reader, all_tiles
from pmtiles.tile import (
    Compression,
    Entry,
    TileType,
    serialize_header,
    zxy_to_tileid,
)
from pmtiles.writer import optimize_directories

LAYERS = (b'contour', b'contour_ft')
# The nth_line values each layer's style draws at a tile zoom, and every line at a zoom missing
# here. A zoom z tile is only drawn between zoom z and z + 1. Keep in sync with
# mbtile_layer.ts#CONTOURS_FEET and mbtile_layer.ts#CONTOURS_METERS.
DRAWN = {
    b'contour': {9: {5, 10}, 10: {5, 10}, 11: {5, 10}, 12: {5, 10}, 13: {2, 10}},
    b'contour_ft': {9: {5, 10}, 10: {5, 10}, 11: {5, 10}, 12: {5, 10}, 13: {10}},
}
# The spec requires the root directory to end within the first 16 KiB.
# https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md#3-header
ROOT_END = 16384
HEADER_LENGTH = 127


def varint(b, i):
    value = 0
    shift = 0
    while True:
        byte = b[i]
        i += 1
        value |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return value, i
        shift += 7


def encode_varint(value):
    out = bytearray()
    while value > 0x7F:
        out.append((value & 0x7F) | 0x80)
        value >>= 7
    out.append(value)
    return bytes(out)


def fields(message):
    """Yields each field's number, where the field starts, and where its value starts and ends."""
    i = 0
    while i < len(message):
        start = i
        key, i = varint(message, i)
        field, wire = key >> 3, key & 7
        if wire == 0:
            value_start = i
            _, i = varint(message, i)
        elif wire == 2:
            length, value_start = varint(message, i)
            i = value_start + length
        elif wire == 5:
            value_start = i
            i += 4
        else:
            value_start = i
            i += 8
        yield field, start, value_start, i


def layer_name(layer):
    for field, _, value_start, end in fields(layer):
        if field == 1:
            return layer[value_start:end]
    return None


def keep_drawn(layer, drawn):
    """Returns the layer without the features whose nth_line the style never draws."""
    # layer: 1 name, 2 features, 3 keys, 4 values; feature: 2 tags as packed key,value indexes
    keys = []
    values = []
    for field, _, value_start, end in fields(layer):
        if field == 3:
            keys.append(layer[value_start:end])
        elif field == 4:
            value = None
            for value_field, _, start, value_end in fields(layer[value_start:end]):
                # int_value, uint_value
                if value_field in (4, 5):
                    value, _ = varint(layer[value_start:end], start)
            values.append(value)
    nth_line = keys.index(b'nth_line')

    out = bytearray()
    kept = 0
    for field, start, value_start, end in fields(layer):
        if field == 2:
            feature = layer[value_start:end]
            nth = None
            for feature_field, _, tags_start, tags_end in fields(feature):
                if feature_field == 2:
                    i = tags_start
                    while i < tags_end:
                        key, i = varint(feature, i)
                        value, i = varint(feature, i)
                        if key == nth_line:
                            nth = values[value]
            if nth not in drawn:
                continue
            kept += 1
        out += layer[start:end]
    return bytes(out), kept


def split(item):
    (z, x, y), data = item
    if data[:2] == b'\x1f\x8b':
        data = gzip.decompress(data)
    # A vector tile is nothing but repeated layer messages in field 3, each self-contained, so we
    # copy them out without decoding any geometry.
    out = {}
    i = 0
    while i < len(data):
        _, i = varint(data, i)
        length, i = varint(data, i)
        layer = data[i:i + length]
        name = layer_name(layer)
        i += length
        if name not in LAYERS:
            continue
        drawn = DRAWN[name].get(z)
        if drawn is not None:
            layer, kept = keep_drawn(layer, drawn)
            if kept == 0:
                continue
        out[name] = gzip.compress(
            b'\x1a' + encode_varint(len(layer)) + layer, compresslevel=6, mtime=0)
    return zxy_to_tileid(z, x, y), len(data), out.get(LAYERS[0]), out.get(LAYERS[1])


class DirectWriter:
    """Writes tile data straight into the archive, so the peak disk use is the archive's size."""

    def __init__(self, path):
        self.f = open(path, 'wb')
        self.f.seek(ROOT_END)
        self.tile_ids = array.array('Q')
        self.offsets = array.array('Q')
        self.lengths = array.array('L')
        self.run_lengths = array.array('L')
        self.offset = 0
        self.addressed = 0
        self.last = None

    def write_tile(self, tile_id, data):
        self.addressed += 1
        # Only consecutive duplicates dedupe, because a hash of every tile costs gigabytes and the
        # source archive holds 0.1% duplicates.
        if (self.last == data
                and tile_id == self.tile_ids[-1] + self.run_lengths[-1]):
            self.run_lengths[-1] += 1
            return
        self.f.write(data)
        self.tile_ids.append(tile_id)
        self.offsets.append(self.offset)
        self.lengths.append(len(data))
        self.run_lengths.append(1)
        self.offset += len(data)
        self.last = data

    def finalize(self, header, metadata):
        entries = [
            Entry(self.tile_ids[i], self.offsets[i], self.lengths[i], self.run_lengths[i])
            for i in range(len(self.tile_ids))
        ]
        root, leaves, _ = optimize_directories(entries, ROOT_END - HEADER_LENGTH)
        del entries
        compressed_metadata = gzip.compress(json.dumps(metadata).encode(), mtime=0)

        # tile data, then metadata, then leaf directories
        metadata_offset = ROOT_END + self.offset
        self.f.write(compressed_metadata)
        self.f.write(leaves)

        header = dict(header)
        header.update({
            'addressed_tiles_count': self.addressed,
            'tile_entries_count': len(self.tile_ids),
            'tile_contents_count': len(self.tile_ids),
            'clustered': True,
            'internal_compression': Compression.GZIP,
            'tile_compression': Compression.GZIP,
            'tile_type': TileType.MVT,
            # The source archive leaves the bounds empty, which pmtiles verify rejects
            'min_lon_e7': -1800000000,
            'min_lat_e7': -850511287,
            'max_lon_e7': 1800000000,
            'max_lat_e7': 850511287,
            'root_offset': HEADER_LENGTH,
            'root_length': len(root),
            'metadata_offset': metadata_offset,
            'metadata_length': len(compressed_metadata),
            'leaf_directory_offset': metadata_offset + len(compressed_metadata),
            'leaf_directory_length': len(leaves),
            'tile_data_offset': ROOT_END,
            'tile_data_length': self.offset,
        })
        self.f.seek(0)
        self.f.write(serialize_header(header))
        self.f.write(root)
        self.f.close()


def main():
    source, meters_path, feet_path = sys.argv[1:4]
    with open(source, 'rb') as f:
        get_bytes = MmapSource(f)
        reader = Reader(get_bytes)
        header = reader.header()
        metadata = reader.metadata()
        meters = DirectWriter(meters_path)
        feet = DirectWriter(feet_path)
        before = 0
        count = 0
        with multiprocessing.Pool() as pool:
            # imap keeps the archive's order, so the outputs stay clustered
            for tile_id, size, m, ft in pool.imap(split, all_tiles(get_bytes), chunksize=256):
                if m is not None:
                    meters.write_tile(tile_id, m)
                if ft is not None:
                    feet.write_tile(tile_id, ft)
                before += size
                count += 1
                if count % 100000 == 0:
                    print(
                        f'{count} tiles, {before >> 20} MB to {meters.offset >> 20} MB meters and '
                        f'{feet.offset >> 20} MB feet',
                        flush=True)
        meters.finalize(header, metadata)
        feet.finalize(header, metadata)
        print(
            f'{count} tiles, {before >> 20} MB to {meters.offset >> 20} MB meters and '
            f'{feet.offset >> 20} MB feet')


if __name__ == '__main__':
    main()
