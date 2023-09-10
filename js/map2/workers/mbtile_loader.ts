import { checkArgument, checkExhaustive, checkExists } from 'js/common/asserts';
import { DefaultMap } from 'js/common/collections';
import { LittleEndianView } from 'js/common/little_endian_view';

import { RgbaU32, TileId } from '../common/types';

import { GeometryType } from './mbtile_types';
import { Triangles, triangulateMb } from './triangulate';

interface InitializeRequest {
  kind: 'ir';
  style: Style;
}

export interface Style {
  polygons: PolygonStyle[];
}

type GeometryStyle = PolygonStyle;

interface PolygonStyle {
  filters: Match[];
  fill: RgbaU32;
  z: number;
}

interface AlwaysMatch {
  match: 'always';
}

interface StringEqualsMatch {
  match: 'string_equals';
  key: string;
  value: string;
}

type Match = AlwaysMatch|StringEqualsMatch;

interface LoadRequest {
  kind: 'lr';
  id: TileId;
  data: ArrayBuffer;
}

export type Request = InitializeRequest|LoadRequest;

export interface LoadResponse {
  kind: 'lr';
  id: TileId;
  geometry: ArrayBuffer;
  index: ArrayBuffer;
  lines: InstanceGeometry[];
  points: InstanceGeometry[];
  polygons: ElementGeometry[];
}

export interface ElementGeometry {
  geometryByteLength: number;
  geometryOffset: number;
  indexCount: number;
  indexOffset: number;
  z: number;
}

export interface InstanceGeometry {
  geometryByteLength: number;
  geometryOffset: number;
  indexCount: number;
  indexOffset: number;
  z: number;
}

export type Response = LoadResponse;

type ValueType = boolean|number|string;

interface Layer {
  keys: string[];
  values: ValueType[];
  lines: Feature[];
  points: Feature[];
  polygons: Feature[];
}

interface Feature {
  tags: number[];
  geometry: number[];
  starts: number[];
}

const PREFERRED_LANGUAGE = navigator.language.split('-')[0];
const TEXT_DECODER = new TextDecoder();

class MbtileLoader {

  constructor(
      private readonly style: Style,
      private readonly postMessage: (response: Response, transfer?: Transferable[]) => void,
  ) {}

  load(request: LoadRequest) {
    // Who amonst us hasn't written a proto parser manually...
    // https://github.com/mapbox/vector-tile-spec/blob/master/2.1/vector_tile.proto
    const source = new LittleEndianView(request.data);

    const layers = [];
    while (source.hasRemaining()) {
      const tag = source.getInt8();
      const wireType = tag & 0x7;
      const field = tag >> 3;

      if (wireType === 2) {
        const size = source.getVarInt32();
        const embedded = source.viewSlice(size);
        if (field === 3) {
          layers.push(loadLayer(embedded, request.id));
        }
      } else {
        throw new Error(`Unknown wire type ${wireType} for field ${field}`);
      }
    }

    const grouped = new DefaultMap<PolygonStyle, Feature[]>(() => []);
    for (const layer of layers) {
      for (const polygon of layer.polygons) {
        const style = findStyle(polygon.tags, layer.keys, layer.values, this.style.polygons);
        if (style) {
          grouped.get(style).push(polygon);
        }
      }
    }

    const triangulated = new Map<PolygonStyle, Triangles[]>();
    let geometryCount = 0;
    let indexCount = 0;
    for (const [style, polygons] of grouped) {
      const triangless = [];
      for (const polygon of polygons) {
        const triangles = triangulateMb(polygon.geometry, polygon.starts)
        geometryCount += triangles.geometry.length;
        indexCount += triangles.index.length;
        triangless.push(triangles);
      }
      triangulated.set(style, triangless);
    }

    const geometry = new Float32Array(triangulated.size + geometryCount);
    const geometryUints = new Uint32Array(geometry.buffer);
    const index = new Uint32Array(indexCount);
    let geometryOffset = 0;
    let indexOffset = 0;

    const response: LoadResponse = {
      kind: 'lr',
      id: request.id,
      geometry: geometry.buffer,
      index: index.buffer,
      lines: [],
      points: [],
      polygons: [],
    };

    for (const [style, triangless] of triangulated) {
      const geometryStart = geometryOffset;
      const indexStart = indexOffset;

      geometryUints[geometryOffset] = style.fill;
      geometryOffset += 1;

      for (const triangles of triangless) {
        geometry.set(triangles.geometry, geometryOffset);
        for (let i = 0; i < triangles.index.length; ++i) {
          index[indexOffset + i] = triangles.index[i] + (geometryOffset - geometryStart - 1) / 2;
        }
        geometryOffset += triangles.geometry.length;
        indexOffset += triangles.index.length;
      }

      response.polygons.push({
        geometryByteLength: 4 * (geometryOffset - geometryStart),
        geometryOffset: 4 * geometryStart,
        indexCount: indexOffset - indexStart,
        indexOffset: 4 * indexStart,
        z: style.z,
      });
    }

    this.postMessage(response, [geometry.buffer, index.buffer]);
  }
}

function start(ir: InitializeRequest) {
  const fetcher = new MbtileLoader(ir.style, (self as any).postMessage.bind(self));
  self.onmessage = e => {
    const request = e.data as Request;
    if (request.kind === 'ir') {
      throw new Error('Already initialized');
    } else if (request.kind === 'lr') {
      fetcher.load(request);
    } else {
      checkExhaustive(request);
    }
  };
}

self.onmessage = e => {
  const request = e.data as Request;
  if (request.kind !== 'ir') {
    throw new Error('Expected an initialization request');
  }

  start(request);
};

function loadLayer(source: LittleEndianView, tile: TileId): Layer {
  let version;
  let name = '';
  let extent = 4096;
  const layer: Layer = {
    keys: [],
    values: [],
    lines: [],
    points: [],
    polygons: [],
  };

  while (source.hasRemaining()) {
    const tag = source.getInt8();
    const wireType = tag & 0x7;
    const field = tag >> 3;

    if (wireType === 0) {
      const value = source.getVarInt32();
      if (field === 5) {
        extent = value;
      } else if (field === 15) {
        version = value;
      }
    } else if (wireType === 2) {
      const size = source.getVarInt32();
      if (field === 1) {
        name = TEXT_DECODER.decode(source.sliceInt8(size));
      } else if (field === 2) {
        loadFeature(source.viewSlice(size), layer);
      } else if (field === 3) {
        layer.keys.push(TEXT_DECODER.decode(source.sliceInt8(size)));
      } else if (field === 4) {
        layer.values.push(loadValue(source.viewSlice(size)));
      } else {
        // skip the field
        source.viewSlice(size);
      }
    } else {
      throw new Error(`Unknown wire type ${wireType} for field ${field}`);
    }
  }

  projectLayer(tile, extent, layer);

  return layer;
}

function loadFeature(source: LittleEndianView, layer: Layer): void {
  let type;
  let geometry;
  let starts;
  let tags;
  while (source.hasRemaining()) {
    const tag = source.getInt8();
    const wireType = tag & 0x7;
    const field = tag >> 3;

    if (wireType === 0) {
      const value = source.getVarInt32();
      if (field === 3) {
        type = value;
      }
    } else if (wireType === 2) {
      const slice = source.viewSlice(source.getVarInt32());
      if (field === 2) {
        tags = [];
        while (slice.hasRemaining()) {
          tags.push(slice.getVarInt32());
        }
      } else if (field === 4) {
        const result = decodeGeometry(slice);
        geometry = result.geometry;
        starts = result.starts;
      }
    } else {
      throw new Error(`Unknown wire type ${wireType} for field ${field}`);
    }
  }

  if (type === GeometryType.Point) {
    layer.points.push({
      tags: tags ?? [],
      geometry: checkExists(geometry),
      starts: checkExists(starts),
    });
  } else if (type === GeometryType.Line) {
    layer.lines.push({
      tags: tags ?? [],
      geometry: checkExists(geometry),
      starts: checkExists(starts),
    });
  } else if (type === GeometryType.Polygon) {
    layer.polygons.push({
      tags: tags ?? [],
      geometry: checkExists(geometry),
      starts: checkExists(starts),
    });
  }
}

function decodeGeometry(source: LittleEndianView): {
  geometry: number[];
  starts: number[];
} {
  let cursorX = 0;
  let cursorY = 0;
  const geometry: number[] = [];
  const starts: number[] = [];

  while (source.hasRemaining()) {
    const tag = source.getVarInt32();
    const command = tag & 0x7;
    const count = tag >> 3;
    if (command === 1) { // move to
      for (let j = 0; j < count; j += 1) {
        starts.push(geometry.length);
        const x = cursorX + deZigZag(source.getVarInt32());
        const y = cursorY + deZigZag(source.getVarInt32());
        geometry.push(x, y);
        cursorX = x;
        cursorY = y;
      }
    } else if (command === 2) { // line to
      for (let j = 0; j < count; j += 1) {
        const x = cursorX + deZigZag(source.getVarInt32());
        const y = cursorY + deZigZag(source.getVarInt32());
        geometry.push(x, y);
        cursorX = x;
        cursorY = y;
      }
    } else if (command === 7) { // close path
      checkArgument(count === 1);
      // we actually don't need to do anything because the last point is the first point
    } else {
      throw new Error(`Unknown command ${command}`);
    }
  }
  return {
    geometry,
    starts,
  };
}

function projectLayer(tile: TileId, extent: number, layer: Layer): void {
  const halfWorldSize = Math.pow(2, tile.zoom - 1);
  const tx = tile.x / halfWorldSize;
  const ty = 1 - tile.y / halfWorldSize;
  const increment = 1 / halfWorldSize / extent;

  for (const source of [layer.lines, layer.points, layer.polygons]) {
    for (const feature of source) {
      const g = feature.geometry;
      for (let i = 0; i < g.length; i += 2) {
        g[i + 0] = tx + g[i + 0] * increment - 1;
        g[i + 1] = ty - g[i + 1] * increment;
      }
    }
  }
}

function deZigZag(u: number): number {
  return (u >>> 1) ^ -(u & 1);
}

function loadValue(data: LittleEndianView): ValueType {
  let boolean;
  let number;
  let string;
  while (data.hasRemaining()) {
    const tag = data.getInt8();
    const wireType = tag & 0x7;
    const field = tag >> 3;

    if (wireType === 0) {
      const value = data.getVarInt32();
      if (field === 4 || field === 5) {
        number = value;
      } else if (field === 6) {
        number = deZigZag(value);
      } else if (field === 7) {
        boolean = !!value;
      }
    } else if (wireType === 2) {
      const size = data.getVarInt32();
      if (field === 1) {
        string = TEXT_DECODER.decode(data.sliceInt8(size));
      } else {
        throw new Error(`Unknown field ${field}`);
      }
    } else {
      throw new Error(`Unknown wire type ${wireType} for field ${field}`);
    }
  }

  return boolean ?? number ?? string ?? 0;
}

function findStyle<S extends GeometryStyle>(
        tags: number[], keys: string[], values: ValueType[], styles: S[]):
    S|undefined {
  for (const style of styles) {
    if (matches(tags, keys, values, style.filters)) {
      return style;
    }
  }
  return undefined;
}

function matches(tags: number[], keys: string[], values: ValueType[], filters: Match[]): boolean {
  for (const filter of filters) {
    switch (filter.match) {
      case "string_equals": {
        for (let i = 0; i < tags.length; i += 2) {
          const key = keys[tags[i + 0]];
          const value = values[tags[i + 1]];
          if (key === filter.key && value === filter.value) {
            return true;
          }
        }
        break;
      }
      case "always": return true;
    }
  }
  return false;
}
