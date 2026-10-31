import { checkArgument, checkExhaustive, checkExists } from 'external/dev_april_corgi+/js/common/asserts';
import { DefaultMap } from 'external/dev_april_corgi+/js/common/collections';
import { LittleEndianView } from 'external/dev_april_corgi+/js/common/little_endian_view';
import { clamp } from 'external/dev_april_corgi+/js/common/math';

import { RgbaU32, TileId, Vec2 } from '../common/types';
import { rgbaToUint32 } from '../common/math';
import { LinePattern, LineProgram, VERTEX_STRIDE as LINE_VERTEX_STRIDE } from '../rendering/line_program';
import { FONT_SIZE, MAX_GLYPH_TURN, toGraphemes, track, wrap } from '../rendering/glypher';

import {
  clipAround,
  Contour,
  lineAnchors,
  maxTurnWithin,
  mergeLines,
  newContour,
  polylineLength,
  reverse,
  sampleAt,
  smoothLine,
  uphillSide,
} from './line_labels';
import { Reply, serveClients } from './client_pool';
import { GeometryType } from './mbtile_types';
import { MAX_TRIANGLE_LENGTH_METERS, Triangles, triangulateMb } from './triangulate';
import { cropLine, cropPolygon } from './tile_crop';

export interface Initialize {
  style: Style;
}

interface SetStyleRequest {
  kind: 'sr';
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
  pattern: LinePattern;
  z: number;
}

interface LineTextStyle {
  filters: Match[];
  preferred: string;
  fallback: string;
  fill: RgbaU32;
  stroke: RgbaU32;
  scale: number;
  // LINE_LABEL_SPACING_PX if unset
  spacingPx?: number;
  // Clear space the placer keeps around each glyph, label_placer.ts#PAD_PX if unset
  padPx?: number;
  // Reads the text as a height and turns its top toward the higher of the neighboring lines, see
  // MAX_UPHILL_TILT
  uphill?: boolean;
  z: number;
}

interface PointStyle {
  filters: Match[];
  textFill: RgbaU32;
  textStroke: RgbaU32;
  textScale: number;
  // Sets the name in spaced capitals, see glypher#track
  caps?: boolean;
  // Wraps the name after the first space past this many graphemes, 8 if unset
  wrapGraphemes?: number;
  z: number;
}

interface PolygonStyle {
  filters: Match[];
  fill: RgbaU32;
  // Names a #rrggbb property that replaces the rgb of fill, keeping its alpha
  fillKey?: string;
  // Sends the polygon back with its properties so the layer can say what is at a point
  queryable?: boolean;
  stroke: RgbaU32;
  strokeRadius: number;
  strokePattern: LinePattern;
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
  // Integer viewport-zoom bucket the caller wants this tile styled against.
  // Independent of id.zoom (the fetched MVT's zoom), since spherical-mode
  // tile fetches use a lower zoom than the viewport (commit 9af3745) but
  // the rendered layer-style detail should still match the viewport.
  styleZoom: number;
  data: ArrayBuffer;
}

export type Request = LoadRequest|SetStyleRequest;

export interface LoadResponse {
  kind: 'lr';
  id: TileId;
  geometry: ArrayBuffer;
  index: ArrayBuffer;
  labels: Label[];
  lines: InstanceGeometry[];
  points: InstanceGeometry[];
  polygons: ElementGeometry[];
  queryable: QueryableFeature[];
}

export interface QueryableFeature {
  // in world coordinates, where the world is -1 to 1
  geometry: number[];
  starts: number[];
  properties: Record<string, ValueType>;
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
  // Mercator x,y pairs the glyphs follow, on labels that came from a line. Point labels have
  // none and lay out straight around center.
  path?: number[];
  graphemes: string[];
  fill: RgbaU32;
  stroke: RgbaU32;
  scale: number;
  z: number;
  // Orders labels of the same z for placement, highest first. See line_labels#lineAnchors.
  rank: number;
  // Lays the glyphs in the direction of path even where that reads upside down
  keepDirection?: boolean;
  padPx?: number;
}

export type Response = LoadResponse;

export type ValueType = boolean|number|string;

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

// How far apart candidate labels along a line start at styleZoom, which the viewport zoom
// stretches up to twice as far by the next bucket. The placer thins them to its repeat distance.
const LINE_LABEL_SPACING_PX = 128;
// How far from upright a label may turn to face uphill, or else every label on a north-facing slope
// reads upside down. The 20 degrees past vertical keeps labels on a contour that wavers about
// vertical from flipping back and forth.
const MAX_UPHILL_TILT = Math.PI / 2 + Math.PI / 9;
// A point has one place to put its name, so it goes before any line label of the same z.
const POINT_LABEL_RANK = 64;
const TEXT_DECODER = new TextDecoder();

class MbtileLoader {

  // The bands holding each style zoom, folded into one style per layer name
  private readonly bands = new Map<number, Map<string, LayerStyle>>();

  constructor(private style: Style) {}

  setStyle(style: Style): void {
    this.style = style;
    this.bands.clear();
  }

  // Concatenates every band holding the zoom in style order, so a style can split one tile layer
  // across several entries, like the airport and road rules that both draw protomaps' roads, and
  // findStyle still takes the first match.
  private layerStyle(layerName: string, zoom: number): LayerStyle|undefined {
    let byName = this.bands.get(zoom);
    if (!byName) {
      byName = new Map();
      for (const ls of this.style.layers) {
        if (ls.minZoom > zoom || zoom >= ls.maxZoom) {
          continue;
        }
        const existing = byName.get(ls.layerName);
        if (existing) {
          existing.lineTexts.push(...ls.lineTexts);
          existing.lines.push(...ls.lines);
          existing.points.push(...ls.points);
          existing.polygons.push(...ls.polygons);
        } else {
          byName.set(ls.layerName, {
            ...ls,
            lineTexts: [...ls.lineTexts],
            lines: [...ls.lines],
            points: [...ls.points],
            polygons: [...ls.polygons],
          });
        }
      }
      this.bands.set(zoom, byName);
    }
    return byName.get(layerName);
  }

  load(request: LoadRequest): Reply<Response> {
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
    const fillStyles =
        new DefaultMap<PolygonStyle, Map<string, PolygonStyle>>(() => new Map());
    const queryable: QueryableFeature[] = [];
    for (const layer of layers) {
      const layerStyle = this.layerStyle(layer.name, request.styleZoom);
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
            if (layer.keys[line.tags[i + 0]] === 'kind') {
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
            if (layer.keys[point.tags[i + 0]] === 'kind') {
              pointUnstyled.add(layer.values[point.tags[i + 1]]);
            }
          }
        }
      }

      for (const polygon of layer.polygons) {
        const style = findStyle(polygon.tags, layer.keys, layer.values, layerStyle.polygons);
        if (style && style.fill) {
          polygonGroups.get(getFilledStyle(style, polygon.tags, layer, fillStyles)).push(polygon);
          if (style.queryable) {
            const properties: Record<string, ValueType> = {};
            for (let i = 0; i < polygon.tags.length; i += 2) {
              properties[layer.keys[polygon.tags[i + 0]]] = layer.values[polygon.tags[i + 1]];
            }
            queryable.push({geometry: polygon.geometry, starts: polygon.starts, properties});
          }
        } else {
          // TODO(april): double counts with polygonBounds but who cares
          for (let i = 0; i < polygon.tags.length; i += 2) {
            if (layer.keys[polygon.tags[i + 0]] === 'kind') {
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
            if (layer.keys[polygon.tags[i + 0]] === 'kind') {
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
        const triangles =
          triangulateMb(polygon.geometry, polygon.starts, MAX_TRIANGLE_LENGTH_METERS);
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
      queryable,
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
                style.pattern,
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

    // Pixels per mercator unit at styleZoom, where the world is -1 to 1.
    const pixelsPerWorld = 256 * Math.pow(2, request.styleZoom - 1);
    // By layer, the lines that uphill labels look across to
    const contours = new DefaultMap<Layer, Contour[]>(() => []);
    for (const [style, lineTexts] of lineTextGroups) {
      const spacing = (style.spacingPx ?? LINE_LABEL_SPACING_PX) / pixelsPerWorld;
      const byText = new DefaultMap<string, number[][]>(() => []);
      if (style.uphill) {
        for (const {layer} of lineTexts) {
          if (contours.has(layer)) {
            continue;
          }
          const heights = contours.get(layer);
          for (const line of layer.lines) {
            for (let i = 0; i < line.tags.length; i += 2) {
              if (layer.keys[line.tags[i + 0]] === style.fallback) {
                heights.push(
                    newContour(Number(layer.values[line.tags[i + 1]]), line.geometry, line.starts));
              }
            }
          }
        }
      }
      for (const lineText of lineTexts) {
        let textFallback;
        let textPreferred;
        for (let i = 0; i < lineText.tags.length; i += 2) {
          const key = lineText.layer.keys[lineText.tags[i + 0]];
          // Contours label their numeric height
          if (key === style.fallback) {
            textFallback = String(lineText.layer.values[lineText.tags[i + 1]]);
          } else if (key === style.preferred) {
            textPreferred = String(lineText.layer.values[lineText.tags[i + 1]]);
          }
        }

        const text = textPreferred ?? textFallback;
        if (!text) {
          continue;
        }

        const parts = byText.get(text);
        for (let i = 0; i < lineText.starts.length; ++i) {
          const start = lineText.starts[i];
          const end =
              i + 1 < lineText.starts.length ? lineText.starts[i + 1] : lineText.geometry.length;
          parts.push(lineText.geometry.slice(start, end));
        }
      }

      for (const [text, parts] of byText) {
        const graphemes = toGraphemes(text);
        // Glyph metrics live in the atlas, which a worker has no fonts to build, so guess the
        // width from Roboto's average advance of a little over half an em.
        const width = graphemes.length * FONT_SIZE * 0.6 * style.scale / pixelsPerWorld;
        // A glyph advance is at most about an em, and it only shrinks against the line as the
        // viewport zooms past styleZoom.
        const em = FONT_SIZE * style.scale / pixelsPerWorld;
        for (const line of mergeLines(parts)) {
          // A quarter width of margin because styleZoom is the floor of the viewport zoom and the
          // text halves against the line by the next bucket. The placer drops what doesn't fit
          // at the live zoom.
          const length = polylineLength(line);
          for (const {at, rank} of lineAnchors(length, spacing, width / 4)) {
            // Three quarters of a width either side leaves room for the text to slide along a
            // curve and for the width guess to run short, without paying for the whole road.
            // The vertices of a stream zigzag at a smaller scale than its bends, and glyphs that
            // take their angles from those segments tilt every which way.
            const path =
                smoothLine(
                    clipAround(line, at - 0.75 * width, at + 0.75 * width),
                    /* step= */ em / 4,
                    /* radius= */ em);
            // Two glyphs an advance apart that differ in angle by more than MAX_GLYPH_TURN stop
            // reading as one word. Checking every em of the path once here, rather than the
            // glyphs as they land at each zoom, keeps the label from flickering as it zooms.
            if (maxTurnWithin(path, em) > MAX_GLYPH_TURN) {
              continue;
            }

            const [centerX, centerY, heading] = sampleAt(line, at);
            const side =
                style.uphill
                    ? uphillSide(
                        centerX,
                        centerY,
                        heading,
                        Number(text),
                        contours.get(lineTexts[0].layer))
                    : 0;
            // The top of the text faces the left of its path
            const uphillAngle =
                side >= 0 ? heading : heading > 0 ? heading - Math.PI : heading + Math.PI;
            const facesUphill = side !== 0 && Math.abs(uphillAngle) <= MAX_UPHILL_TILT;
            let angle = heading;
            if (facesUphill) {
              angle = uphillAngle;
            } else if (angle < -Math.PI / 2) {
              angle = angle + Math.PI;
            } else if (angle > Math.PI / 2) {
              angle = angle - Math.PI;
            }

            response.labels.push({
              angle,
              center: [centerX, centerY],
              path: facesUphill && side < 0 ? reverse(path) : path,
              keepDirection: facesUphill,
              padPx: style.padPx,
              // Line labels render rotated along the line direction. Wrapping turns them into
              // a tilted multi-line block which looks wrong; keep them single-line.
              graphemes,
              fill: style.fill,
              stroke: style.stroke,
              scale: style.scale,
              z: style.z,
              rank,
            });
          }
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
          const wrapped = wrap(toGraphemes(text), style.wrapGraphemes ?? 8);
          response.labels.push({
            angle: 0,
            center: point.geometry as unknown as Vec2,
            graphemes:
                style.caps
                    ? track(wrapped.map(grapheme => grapheme.toLocaleUpperCase()))
                    : wrapped,
            fill: style.textFill,
            stroke: style.textStroke,
            scale: style.textScale,
            z: style.z,
            rank: POINT_LABEL_RANK,
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
                style.strokePattern,
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

    return {message: response, transfer: [geometry.buffer, index.buffer]};
  }
}

serveClients<Initialize, Request, Response>(init => {
  const loader = new MbtileLoader(init.style);
  return request => {
    if (request.kind === 'lr') {
      return loader.load(request);
    } else if (request.kind === 'sr') {
      loader.setStyle(request.style);
      return undefined;
    } else {
      throw checkExhaustive(request);
    }
  };
});

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
    } else if (wireType === 1) {
      if (field === 3) {
        number = data.getFloat64();
      } else {
        throw new Error(`Unknown field ${field}`);
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

// Returns one style per distinct color so that every polygon in a group shares a fill.
function getFilledStyle(
    style: PolygonStyle,
    tags: number[],
    layer: Layer,
    cache: DefaultMap<PolygonStyle, Map<string, PolygonStyle>>): PolygonStyle {
  if (!style.fillKey) {
    return style;
  }
  let hex;
  for (let i = 0; i < tags.length; i += 2) {
    if (layer.keys[tags[i + 0]] === style.fillKey) {
      hex = layer.values[tags[i + 1]];
      break;
    }
  }
  if (typeof hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(hex)) {
    return style;
  }
  const byColor = cache.get(style);
  let filled = byColor.get(hex);
  if (!filled) {
    filled = {
      ...style,
      fill: ((parseInt(hex.substring(1), 16) << 8 | (style.fill & 0xFF)) >>> 0) as RgbaU32,
    };
    byColor.set(hex, filled);
  }
  return filled;
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
    if (filter.match === 'always') {
      continue;
    }

    let matched = false;
    for (let i = 0; i < tags.length && !matched; i += 2) {
      if (keys[tags[i + 0]] !== filter.key) {
        continue;
      }
      const value = values[tags[i + 1]];
      switch (filter.match) {
        case 'greater_than':
          matched = (value as number) > filter.value;
          break;
        case 'less_than':
          matched = (value as number) < filter.value;
          break;
        case 'number_equals':
        case 'string_equals':
          matched = value === filter.value;
          break;
        case 'string_in':
          matched = filter.value.some(candidate => value === candidate);
          break;
        default:
          checkExhaustive(filter);
      }
    }

    if (!matched) {
      return false;
    }
  }

  return true;
}
