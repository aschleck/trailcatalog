import { checkArgument, checkExhaustive, checkExists, exists } from 'external/dev_april_corgi+/js/common/asserts';
import { DefaultMap } from 'external/dev_april_corgi+/js/common/collections';
import { LittleEndianView } from 'external/dev_april_corgi+/js/common/little_endian_view';
import { clamp } from 'external/dev_april_corgi+/js/common/math';

import { RgbaU32, TileId, Vec2 } from '../common/types';
import { rgbaToUint32 } from '../common/math';
import { LineProgram, VERTEX_STRIDE as LINE_VERTEX_STRIDE } from '../rendering/line_program';
import { toGraphemes } from '../rendering/glypher';

import { GeometryType } from './mbtile_types';
import { Triangles, triangulateMb } from './triangulate';

interface InitializeRequest {
  kind: 'ir';
  style: Style;
}

export interface Style {
  layers: LayerStyle[];
}

interface LayerStyle {
  layerName: string;
  minZoom: number;
  maxZoom: number;
  lineTexts: LineTextStyle[];
  lines: LineStyle[];
  points: PointStyle[];
  polygons: PolygonStyle[];
}

// https://medialab.github.io/iwanthue/
const RANDOM_COLORS_RGB = [
  [109,188,123],
  [186,83,185],
  [81,195,95],
  [113,102,217],
  [145,186,53],
  [110,112,187],
  [202,165,58],
  [93,157,214],
  [207,73,51],
  [77,193,180],
  [214,68,117],
  [73,138,50],
  [215,141,201],
  [55,131,93],
  [159,74,115],
  [176,174,98],
  [212,119,111],
  [112,113,41],
  [226,137,58],
  [163,104,52],
];

const RANDOM_COLORS_UINT32 = RANDOM_COLORS_RGB.map(([r,g,b]) => rgbaToUint32(r,g,b,1));

type GeometryStyle = LineStyle|LineTextStyle|PointStyle|PolygonStyle;

interface LineStyle {
  filters: Match[];
  fill: RgbaU32;
  stroke: RgbaU32;
  radius: number;
  stipple: boolean;
  z: number;
}

interface LineTextStyle {
  filters: Match[];
  preferred: string;
  fallback: string;
  fill: RgbaU32;
  stroke: RgbaU32;
  scale: number;
  z: number;
}

interface PointStyle {
  filters: Match[];
  textFill: RgbaU32;
  textStroke: RgbaU32;
  textScale: number;
  z: number;
}

interface PolygonStyle {
  filters: Match[];
  fill: RgbaU32;
  stroke: RgbaU32;
  strokeRadius: number;
  strokeStipple: boolean;
  z: number;
}

interface AlwaysMatch {
  match: 'always';
}

interface GreaterThanMatch {
  match: 'greater_than';
  key: string;
  value: number;
}

interface LessThanMatch {
  match: 'less_than';
  key: string;
  value: number;
}

interface NumberEqualsMatch {
  match: 'number_equals';
  key: string;
  value: number;
}

interface StringEqualsMatch {
  match: 'string_equals';
  key: string;
  value: string;
}

interface StringInMatch {
  match: 'string_in';
  key: string;
  value: string[];
}

type Match =
    AlwaysMatch
        |GreaterThanMatch
        |LessThanMatch
        |NumberEqualsMatch
        |StringEqualsMatch
        |StringInMatch;

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
  labels: Label[];
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
  instanceCount: number;
  vertexCount: number;
  z: number;
}

export interface Label {
  angle: number;
  center: Vec2;
  graphemes: string[];
  fill: RgbaU32;
  stroke: RgbaU32;
  scale: number;
  z: number;
  minZoom: number;
  maxZoom: number;
}

export type Response = LoadResponse;

type ValueType = boolean|number|string;

interface Layer {
  name: string;
  keys: string[];
  values: ValueType[];
  lines: Feature[];
  points: Feature[];
  polygons: Feature[];
  polygonBounds: Feature[];
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
    // I (Josh) have nothing really to back this up but I feel like this would be like 10x faster in WASM.
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

    const lineGroups = new DefaultMap<LineStyle, Feature[]>(() => []);
    // Stupid vscode
    type T1 = Feature & {
      layer: Layer;
      layerStyle: LayerStyle;
    };
    const lineTextGroups = new DefaultMap<LineTextStyle, Array<T1>>(() => []);
    const pointGroups = new DefaultMap<PointStyle, Array<T1>>(() => []);
    const polygonGroups = new DefaultMap<PolygonStyle, Feature[]>(() => []);
    const polygonBoundGroups = new DefaultMap<PolygonStyle, Feature[]>(() => []);
    for (const layer of layers) {
      let layerStyle;
      for (const ls of this.style.layers) {
        if (ls.minZoom <= request.id.zoom
            && request.id.zoom < ls.maxZoom
            && layer.name === ls.layerName) {
          layerStyle = ls;
          break;
        }
      }

      if (!layerStyle) {
        //console.log(`skipped layer ${layer.name}`);
        continue;
      }

      const lineUnstyled = new Set<unknown>();
      const pointUnstyled = new Set<unknown>();
      const polygonUnstyled = new Set<unknown>();
      for (const line of layer.lines) {
        const style = findStyle(line.tags, layer.keys, layer.values, layerStyle.lineTexts);
        if (style) {
          lineTextGroups.get(style).push({...line, layer, layerStyle});
        }
      }

      for (const line of layer.lines) {
        const style = findStyle(line.tags, layer.keys, layer.values, layerStyle.lines);
        if (style) {
          lineGroups.get(style).push(line);
        } else {
          for (let i = 0; i < line.tags.length; i += 2) {
            if (layer.keys[line.tags[i + 0]] === 'class') {
              lineUnstyled.add(layer.values[line.tags[i + 1]]);
            }
          }
        }
      }

      for (const point of layer.points) {
        const style = findStyle(point.tags, layer.keys, layer.values, layerStyle.points);
        if (style) {
          pointGroups.get(style).push({...point, layer, layerStyle});
        } else {
          for (let i = 0; i < point.tags.length; i += 2) {
            if (layer.keys[point.tags[i + 0]] === 'class') {
              pointUnstyled.add(layer.values[point.tags[i + 1]]);
            }
          }
        }
      }

      for (const polygon of layer.polygons) {
        const style = findStyle(polygon.tags, layer.keys, layer.values, layerStyle.polygons);
        if (style && style.fill) {
          polygonGroups.get(style).push(polygon);
        } else {
          // TODO(april): double counts with polygonBounds but who cares
          for (let i = 0; i < polygon.tags.length; i += 2) {
            if (layer.keys[polygon.tags[i + 0]] === 'class') {
              polygonUnstyled.add(layer.values[polygon.tags[i + 1]]);
            }
          }
        }
      }

      for (const polygon of layer.polygonBounds) {
        const style = findStyle(polygon.tags, layer.keys, layer.values, layerStyle.polygons);
        if (style && style.stroke && style.strokeRadius) {
          polygonBoundGroups.get(style).push(polygon);
        } else {
          // TODO(april): double counts with polygons but who cares
          for (let i = 0; i < polygon.tags.length; i += 2) {
            if (layer.keys[polygon.tags[i + 0]] === 'class') {
              polygonUnstyled.add(layer.values[polygon.tags[i + 1]]);
            }
          }
        }
      }

      //if (lineUnstyled.size > 0) {
      //  console.log(`${layer.name} lines`);
      //  console.log(lineUnstyled);
      //}
      //if (pointUnstyled.size > 0) {
      //  console.log(`${layer.name} points`);
      //  console.log(pointUnstyled);
      //}
      //if (polygonUnstyled.size > 0) {
      //  console.log(`${layer.name} polygons`);
      //  console.log(polygonUnstyled);
      //}
    }

    const triangulated = new Map<PolygonStyle, Triangles[]>();
    let geometryCount = 0;
    let indexCount = 0;
    for (const lines of lineGroups.values()) {
      for (const line of lines) {
        geometryCount += LINE_VERTEX_STRIDE / 4 * (line.geometry.length - 2) / 2;
      }
    }
    for (const [style, polygons] of polygonGroups) {
      const triangless = [];
      for (const polygon of polygons) {
        // Among other things, the max triangle length affects the amount of overdraw we see at the
        // edge of the globe.
        const triangles =
          triangulateMb(polygon.geometry, polygon.starts, /* maxTriangleLengthMeters= */ 200_000);
        geometryCount += triangles.geometry.length;
        indexCount += triangles.index.length;
        triangless.push(triangles);
      }
      triangulated.set(style, triangless);
    }
    for (const [style, polygons] of polygonBoundGroups) {
      const triangless = [];
      for (const polygon of polygons) {
        for (let i = 0; i < polygon.starts.length; ++i) {
          const start = polygon.starts[i];
          const end =
              i < polygon.starts.length - 1 ? polygon.starts[i + 1] : polygon.geometry.length;
          geometryCount += LINE_VERTEX_STRIDE / 4 * (end - start - 2) / 2;
        }
      }
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
      labels: [],
      lines: [],
      points: [],
      polygons: [],
    };

    for (const [style, lines] of lineGroups) {
      const geometryStart = geometryOffset;
      let instanceCount = 0;
      let vertexCount = 0;
      for (const line of lines) {
        line.starts.push(line.geometry.length);
        for (let i = 0; i < line.starts.length - 1; i++) {
          const result =
              LineProgram.push(
                style.fill,
                style.stroke,
                style.radius,
                style.stipple,
                line.geometry.slice(line.starts[i], line.starts[i + 1]),
                geometry.buffer,
                4 * geometryOffset);
          geometryOffset += result.geometryByteLength / 4;
          instanceCount += result.instanceCount;
          vertexCount = result.vertexCount;
        }
      }

      response.lines.push({
        geometryByteLength: 4 * (geometryOffset - geometryStart),
        geometryOffset: 4 * geometryStart,
        instanceCount,
        vertexCount,
        z: style.z,
      });
    }

    for (const [style, lineTexts] of lineTextGroups) {
      for (const lineText of lineTexts) {
        let textFallback;
        let textPreferred;
        for (let i = 0; i < lineText.tags.length; i += 2) {
          const key = lineText.layer.keys[lineText.tags[i + 0]];
          if (key === style.fallback) {
            textFallback = lineText.layer.values[lineText.tags[i + 1]] as string;
          } else if (key === style.preferred) {
            textPreferred = lineText.layer.values[lineText.tags[i + 1]] as string;
          }
        }

        const text = textPreferred ?? textFallback;
        if (text) {
          const i = Math.floor(lineText.geometry.length / 4);
          const center = [lineText.geometry[i * 2 + 0], lineText.geometry[i * 2 + 1]] as Vec2;
          let angle =
              Math.atan2(
                  center[1] - lineText.geometry[i * 2 - 1],
                  center[0] - lineText.geometry[i * 2 - 2]);
          if (angle < -Math.PI / 2) {
            angle = angle + Math.PI;
          } else if (angle > Math.PI / 2) {
            angle = angle - Math.PI;
          }

          response.labels.push({
            angle,
            center,
            graphemes: wrap(toGraphemes(text)),
            fill: style.fill,
            stroke: style.stroke,
            scale: style.scale,
            z: style.z,
            minZoom: lineText.layerStyle.minZoom,
            maxZoom: lineText.layerStyle.maxZoom,
          });
        }
      }
    }

    for (const [style, points] of pointGroups) {
      for (const point of points) {
        let textFallback;
        let textPreferred;
        for (let i = 0; i < point.tags.length; i += 2) {
          const key = point.layer.keys[point.tags[i + 0]];
          if (key === 'name') {
            textFallback = point.layer.values[point.tags[i + 1]] as string;
          } else if (key === `name:${PREFERRED_LANGUAGE}`) {
            textPreferred = point.layer.values[point.tags[i + 1]] as string;
          }
        }

        const text = textPreferred ?? textFallback;
        if (text) {
          response.labels.push({
            angle: 0,
            center: point.geometry as unknown as Vec2,
            graphemes: wrap(toGraphemes(text)),
            fill: style.textFill,
            stroke: style.textStroke,
            scale: style.textScale,
            z: style.z,
            minZoom: point.layerStyle.minZoom,
            maxZoom: point.layerStyle.maxZoom,
          });
        }
      }
    }

    for (const [style, polygons] of polygonBoundGroups) {
      const geometryStart = geometryOffset;
      const indexStart = indexOffset;
      let instanceCount = 0;
      let vertexCount = 0;
      for (const polygon of polygons) {
        polygon.starts.push(polygon.geometry.length);
        for (let i = 0; i < polygon.starts.length; ++i) {
          const result =
              LineProgram.push(
                style.stroke, // TODO(april): should we allow stroke fills?
                style.stroke,
                style.strokeRadius,
                style.strokeStipple,
                polygon.geometry.slice(polygon.starts[i], polygon.starts[i + 1]),
                geometry.buffer,
                4 * geometryOffset);
          geometryOffset += result.geometryByteLength / 4;
          instanceCount += result.instanceCount;
          vertexCount = result.vertexCount;
        }
      }

      response.lines.push({
        geometryByteLength: 4 * (geometryOffset - geometryStart),
        geometryOffset: 4 * geometryStart,
        instanceCount,
        vertexCount,
        z: style.z,
      });
    }

    for (const [style, triangless] of triangulated) {
      const geometryStart = geometryOffset;
      const indexStart = indexOffset;

      geometryUints[geometryOffset] = style.fill;
      // geometryUints[geometryOffset] = RANDOM_COLORS_UINT32[Math.floor(Math.random() * RANDOM_COLORS_UINT32.length)];
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
  let extent = 4096;
  const layer: Layer = {
    name: '',
    keys: [],
    values: [],
    lines: [],
    points: [],
    polygons: [],
    polygonBounds: [],
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
        layer.name = TEXT_DECODER.decode(source.sliceInt8(size));
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
    layer.polygonBounds.push({
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
  const tx = tile.x / halfWorldSize - 1;
  const ty = 1 - tile.y / halfWorldSize;
  const increment = 1 / halfWorldSize / extent;

   for (const [crop, loop, source] of [
      [cropLine, false, layer.lines],
      [cropLine, false, layer.points],
      [cropLine, true, layer.polygonBounds],
      [cropPolygon, true, layer.polygons],
   ] as const) {
     for (const feature of source) {
       const [geometry, starts] = crop(feature.geometry, feature.starts, extent, loop);
       feature.geometry = geometry;
       feature.starts = starts;
     }
   }

   layer.lines = layer.lines.filter(f => f.geometry.length > 0 && f.starts.length > 0);
   layer.points = layer.points.filter(f => f.geometry.length > 0 && f.starts.length > 0);
   layer.polygons = layer.polygons.filter(f => f.geometry.length > 0 && f.starts.length > 0);
   layer.polygonBounds =
      layer.polygonBounds.filter(f => f.geometry.length > 0 && f.starts.length > 0);

  for (const source of [layer.lines, layer.points, layer.polygons, layer.polygonBounds]) {
    for (const feature of source) {
      const g = feature.geometry;
      for (let i = 0; i < g.length; i += 2) {
        g[i + 0] = tx + g[i + 0] * increment;
        g[i + 1] = ty - g[i + 1] * increment;
      }
    }
  }
}

function cropLine(geometry: number[], starts: number[], extent: number, loop: boolean):
    [number[], number[]] {
  const cGeometry = [];
  const cStarts = [];
  for (let i = 0; i < starts.length; ++i) {
    const start = starts[i];
    const end = i < starts.length - 1 ? starts[i + 1] : geometry.length;

    let outside = true;
    let lastPushedX = undefined;
    let lastPushedY = undefined;
    for (let i = start; i < end; i += 2) {
      const px = geometry[i + 0];
      const py = geometry[i + 1];

      if ((px >= 0 && px < extent) && (py >= 0 && py < extent)) {
        if (outside) {
          cStarts.push(cGeometry.length);
        }

        if (i > start && outside) {
          const lx = geometry[i - 2 + 0];
          const ly = geometry[i - 2 + 1];
          const [ix, iy] = checkExists(intersectFiniteTile(lx, ly, px, py, extent));
          if (ix !== lastPushedX || iy !== lastPushedY) {
            cGeometry.push(ix, iy);
            lastPushedX = ix;
            lastPushedY = iy;
          }
        }

        if (px !== lastPushedX || py !== lastPushedY) {
          cGeometry.push(px, py);
          lastPushedX = px;
          lastPushedY = py;
        }
        outside = false;
      } else {
        if (i > start) {
          const lx = geometry[i - 2 + 0];
          const ly = geometry[i - 2 + 1];

          if (outside) {
            const intersections =
                intersectInfiniteTile(lx, ly, px, py, extent)
                    .filter(([x, y]) => 0 <= x && x <= extent && 0 <= y && y <= extent);
            let started = false;
            for (const [ix, iy] of intersections) {
              if (ix !== lastPushedX || iy !== lastPushedY) {
                if (!started) {
                  cStarts.push(cGeometry.length);
                  started = true;
                }

                cGeometry.push(ix, iy);
                lastPushedX = ix;
                lastPushedY = iy;
              }
            }
          } else {
            const [ix, iy] = checkExists(intersectFiniteTile(lx, ly, px, py, extent));
            if (ix !== lastPushedX || iy !== lastPushedY) {
              cGeometry.push(ix, iy);
              lastPushedX = undefined;
              lastPushedY = undefined;
            }
          }
        }

        outside = true;
      }
    }

    // Also check for intersections on the way back to the start point
    if (loop) {
      const px = geometry[start + 0];
      const py = geometry[start + 1];

      if ((px >= 0 && px < extent) && (py >= 0 && py < extent)) {
        if (outside) {
          cStarts.push(cGeometry.length);

          const lx = geometry[end - 2 + 0];
          const ly = geometry[end - 2 + 1];
          const [ix, iy] = checkExists(intersectFiniteTile(lx, ly, px, py, extent));
          if (ix !== lastPushedX || iy !== lastPushedY) {
            cGeometry.push(ix, iy);
          }
          if (px !== lastPushedX || py !== lastPushedY) {
            cGeometry.push(px, py);
          }
        } else {
          if (px !== lastPushedX || py !== lastPushedY) {
            cGeometry.push(px, py);
          }
        }
      } else {
        const lx = geometry[end - 2 + 0];
        const ly = geometry[end - 2 + 1];

        if (outside) {
          const intersections =
              intersectInfiniteTile(lx, ly, px, py, extent)
                  .filter(([x, y]) => 0 <= x && x <= extent && 0 <= y && y <= extent);
          let started = false;
          for (const [ix, iy] of intersections) {
            if (ix !== lastPushedX || iy !== lastPushedY) {
              if (!started) {
                cStarts.push(cGeometry.length);
                started = true;
              }

              cGeometry.push(ix, iy);
              lastPushedX = ix;
              lastPushedY = iy;
            }
          }
        } else {
          const [ix, iy] = checkExists(intersectFiniteTile(lx, ly, px, py, extent));
          if (ix !== lastPushedX || iy !== lastPushedY) {
            cGeometry.push(ix, iy);
            lastPushedX = undefined;
            lastPushedY = undefined;
          }
        }
      }
    }
  }

  return [cGeometry, cStarts];
}

function cropPolygon(geometry: number[], starts: number[], extent: number, loop: boolean):
    [number[], number[]] {
  const cGeometry = [];
  const cStarts = [];
  for (let i = 0; i < starts.length; ++i) {
    const start = starts[i];
    const end = i < starts.length - 1 ? starts[i + 1] : geometry.length;
    cStarts.push(cGeometry.length);

    let everInside = false;
    let outside = true;
    let lastPushedX = undefined;
    let lastPushedY = undefined;
    for (let i = start; i < end; i += 2) {
      const px = geometry[i + 0];
      const py = geometry[i + 1];

      if ((px >= 0 && px < extent) && (py >= 0 && py < extent)) {
        everInside = true;
        if (i > start && outside) {
          const lx = geometry[i - 2 + 0];
          const ly = geometry[i - 2 + 1];
          const [ix, iy] = checkExists(intersectFiniteTile(lx, ly, px, py, extent));
          if (ix !== lastPushedX || iy !== lastPushedY) {
            cGeometry.push(ix, iy);
            lastPushedX = ix;
            lastPushedY = iy;
          }
        }

        if (px !== lastPushedX || py !== lastPushedY) {
          cGeometry.push(px, py);
          lastPushedX = px;
          lastPushedY = py;
        }
        outside = false;
      } else {
        if (i > start) {
          const lx = geometry[i - 2 + 0];
          const ly = geometry[i - 2 + 1];

          if (outside) {
            const intersections =
                intersectInfiniteTile(lx, ly, px, py, extent)
                    .map(([x, y]) => [clamp(x, 0, extent), clamp(y, 0, extent)]);
            for (const [ix, iy] of intersections) {
              if (ix !== lastPushedX || iy !== lastPushedY) {
                cGeometry.push(ix, iy);
                lastPushedX = ix;
                lastPushedY = iy;
              }
            }
          } else {
            const [ix, iy] = checkExists(intersectFiniteTile(lx, ly, px, py, extent));
            if (ix !== lastPushedX || iy !== lastPushedY) {
              cGeometry.push(ix, iy);
              lastPushedX = ix;
              lastPushedY = iy;
            }
          }
        }

        outside = true;
      }
    }

    // Also check for intersections on the way back to the start point
    if (loop) {
      const px = geometry[start + 0];
      const py = geometry[start + 1];

      if ((px >= 0 && px < extent) && (py >= 0 && py < extent)) {
        everInside = true;
        if (outside) {
          const lx = geometry[end - 2 + 0];
          const ly = geometry[end - 2 + 1];
          const [ix, iy] = checkExists(intersectFiniteTile(lx, ly, px, py, extent));
          if (ix !== lastPushedX || iy !== lastPushedY) {
            cGeometry.push(ix, iy);
          }
        }
      } else {
        const lx = geometry[end - 2 + 0];
        const ly = geometry[end - 2 + 1];

        if (outside) {
          const intersections =
              intersectInfiniteTile(lx, ly, px, py, extent)
                  .map(([x, y]) => [clamp(x, 0, extent), clamp(y, 0, extent)]);
          for (const [ix, iy] of intersections) {
            if (ix !== lastPushedX || iy !== lastPushedY) {
              cGeometry.push(ix, iy);
              lastPushedX = ix;
              lastPushedY = iy;
            }
          }
        } else {
          const [ix, iy] = checkExists(intersectFiniteTile(lx, ly, px, py, extent));
          if (ix !== lastPushedX || iy !== lastPushedY) {
            cGeometry.push(ix, iy);
            lastPushedX = ix;
            lastPushedY = iy;
          }
        }
      }
    }

    // Check if we failed to push any geometry and skip it if so.
    if ((!everInside && !loop) || cStarts[cStarts.length - 1] === cGeometry.length) {
      cGeometry.length = checkExists(cStarts.pop());
    }
  }

  return [cGeometry, cStarts];
}

function intersectFiniteTile(
    x1: number, y1: number, x2: number, y2: number, extent: number): Vec2|undefined {
  const l = intersectSegments(x1, y1, x2, y2, 0, 0, 0, extent);
  if (l) {
    return [l[1], l[2]];
  }
  const t = intersectSegments(x1, y1, x2, y2, 0, extent, extent, extent);
  if (t) {
    return [t[1], t[2]];
  }
  const r = intersectSegments(x1, y1, x2, y2, extent, extent, extent, 0);
  if (r) {
    return [r[1], r[2]];
  }
  const b = intersectSegments(x1, y1, x2, y2, extent, 0, 0, 0);
  if (b) {
    return [b[1], b[2]];
  }
  return undefined;
}

function intersectInfiniteTile(
    x1: number, y1: number, x2: number, y2: number, extent: number): Vec2[] {
  const huge = 1024 * extent;

  const points = [
    intersectSegments(x1, y1, x2, y2, -huge, 0, huge, 0),
    intersectSegments(x1, y1, x2, y2, extent, -huge, extent, huge),
    intersectSegments(x1, y1, x2, y2, huge, extent, -huge, extent),
    intersectSegments(x1, y1, x2, y2, 0, huge, 0, -huge),
  ];
  // sort by t value
  return points.filter(exists).sort((a, b) => a[0] - b[0]).map(([t, x, y]) => [x, y]);
}

function intersectSegments(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    x3: number,
    y3: number,
    x4: number,
    y4: number): [t: number, x: number, y: number]|undefined {
  const tn = (x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4);
  const td = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (td === 0) {
    return undefined;
  }
  const t = tn / td;

  const un = (x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3);
  const ud = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (ud === 0) {
    return undefined;
  }
  const u = -un / ud;

  if (0 <= t && t <= 1 && 0 <= u && u <= 1) {
    return [t, x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
  } else {
    return undefined;
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
    if (filter.match === 'greater_than') {
      let matched = false;
      for (let i = 0; i < tags.length; i += 2) {
        const key = keys[tags[i + 0]];
        if (key !== filter.key) {
          continue;
        }
        const value = values[tags[i + 1]] as number;
        if (value > filter.value) {
          matched = true;
          break;
        }
      }

      if (!matched) {
        return false;
      }
    } else if (filter.match === 'less_than') {
      let matched = false;
      for (let i = 0; i < tags.length; i += 2) {
        const key = keys[tags[i + 0]];
        if (key !== filter.key) {
          continue;
        }
        const value = values[tags[i + 1]] as number;
        if (value < filter.value) {
          matched = true;
          break;
        }
      }

      if (!matched) {
        return false;
      }
    } else if (filter.match === 'number_equals') {
      let matched = false;
      for (let i = 0; i < tags.length; i += 2) {
        const key = keys[tags[i + 0]];
        if (key !== filter.key) {
          continue;
        }
        const value = values[tags[i + 1]] as number;
        if (value === filter.value) {
          matched = true;
          break;
        }
      }

      if (!matched) {
        return false;
      }
    } else if (filter.match === 'string_equals') {
      let matched = false;
      for (let i = 0; i < tags.length; i += 2) {
        const key = keys[tags[i + 0]];
        const value = values[tags[i + 1]];
        if (key === filter.key && value === filter.value) {
          matched = true;
          break;
        }
      }

      if (!matched) {
        return false;
      }
    } else if (filter.match === 'string_in') {
      let matched = false;
      for (let i = 0; i < tags.length; i += 2) {
        const key = keys[tags[i + 0]];
        const value = values[tags[i + 1]];
        if (key !== filter.key) {
          continue;
        }
        for (const candidate of filter.value) {
          if (value === candidate) {
            matched = true;
            break;
          }
        }
      }
      if (!matched) {
        return false;
      }
    } else if (filter.match === 'always') {
      // Who cares!
    } else {
      checkExhaustive(filter);
    }
  }

  return true;
}

function wrap(text: string[]): string[] {
  const wrapped = [];
  let lastWrap = 0;
  for (let i = 0; i < text.length; ++i) {
    if (i - lastWrap > 8 && text[i] === ' ') {
      wrapped.push('\n');
      lastWrap = i;
    } else {
      wrapped.push(text[i]);
    }
  }
  return wrapped;
}
