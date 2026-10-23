import { checkExhaustive } from 'external/dev_april_corgi+/js/common/asserts';
import { LittleEndianView } from 'external/dev_april_corgi+/js/common/little_endian_view';

import { KIND_PACKED_PATH, KIND_UUID_JSON, OBJECTS_WIRE_VERSION } from 'java/lat/trails/wire/wire';
import { aDescendsB, unpackPathTraits, WayCategory } from 'java/org/trailcatalog/models/categories';

import { S2Polygon } from 'java/org/trailcatalog/s2';
import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';
import { projectE7Deltas, projectE7DeltasInto, projectS2Loop, skipE7Deltas } from 'js/map/camera';
import { LatLngRect, RawUuid, Rect, RgbaU32, Vec2 } from 'js/map/common/types';
import { LinePattern, LineProgram } from 'js/map/rendering/line_program';
import { Reply, serveClients } from 'js/map/workers/client_pool';
import { PackedLines } from 'js/map/workers/location_querier';
import { Terrain, TERRAINS } from 'js/map/workers/path_router';
import { CellKey } from 'js/map/workers/s2_data_fetcher';
import { Triangles } from 'js/map/workers/triangulate';
import { triangulateS2 } from 'js/map/workers/triangulate_s2';

import { CollectionSchema } from './collection_schema';
import { Match, matches } from './filters';
import { SchemaStyler } from './schema_styler';

export interface Initialize {
  styling: Styling;
}

interface SetStyleRequest {
  kind: 'sr';
  styling: Styling;
}

// Rules written by hand, like the OSM ways', or a collection's own schema
export type Styling = {kind: 'rules'; style: Style}|{kind: 'schema'; schema: CollectionSchema};

/** Picks how an object draws, or undefined to drop it. */
export interface Styler {
  line(data: Data, styleZoom: number): LineStyle|undefined;
  point(data: Data): PointStyle|undefined;
  polygon(data: Data): PolygonStyle|undefined;
}

export interface Style {
  lines: LineStyle[];
  points: PointStyle[];
  polygons: PolygonStyle[];
}

export interface LineStyle {
  filters: Match[];
  // Half open, matching the bands in the mbtile styles.
  minZoom: number;
  maxZoom: number;
  fill: RgbaU32;
  // A wider solid line drawn under this one, at a z of its own so that it can also pass under the
  // lines this one crosses
  halo?: {fill: RgbaU32; radius: number; z: number};
  pattern: LinePattern;
  radius: number;
  stroke: RgbaU32;
  z: number;
}

export interface PointStyle {
  filters: Match[];
  fill: RgbaU32;
  stroke: RgbaU32;
  radius: number;
  z: number;
}

export interface PolygonStyle {
  filters: Match[];
  fill: RgbaU32;
  // Drawn along every ring, or not at all when undefined
  outline: LineStyle|undefined;
  z: number;
}

interface LoadRequest {
  kind: 'lr';
  key: CellKey;
  styleZoom: number;
  // Counts the layer's calls to setStyle, echoed so that a cell styled before the last one drops.
  styleEpoch: number;
  // Unused here, only echoed so that the answer says what its geometry was simplified to.
  tolerance: number;
  data: ArrayBuffer;
}

export type Request = LoadRequest|SetStyleRequest;

export interface LoadResponse {
  kind: 'lr';
  key: CellKey;
  styleZoom: number;
  styleEpoch: number;
  tolerance: number;
  geometry: ArrayBuffer;
  index: ArrayBuffer;
  // We merge multiple objects into the *Geometry version, so if we want just the geometry of any
  // one object then we keep the non-*Geometry arrays too.
  lines: LoadedLines;
  lineGeometries: LineGeometry[];
  points: Point[];
  pointGeometries: PointGeometry[];
  polygons: Polygon[];
  polygonGeometries: PolygonGeometry[];
}

/**
 * A cell's lines in parallel arrays, because a cell runs to a hundred thousand lines and cloning an
 * object graph that size is what stalls the main thread. See collection_layer.ts#lineAt.
 */
export interface LoadedLines extends Omit<PackedLines, 'idPrefix'> {
  // lsb then msb for each line
  ids: BigInt64Array;
  data: PackedData;
  geometryByteLengths: Uint32Array;
  geometryOffsets: Uint32Array;
  // Indices into styles
  styleIndices: Uint16Array;
  styles: LineStyle[];
}

type PackedData =
    {kind: 'packed_path'; ids: Float64Array; types: Int32Array; traits: Int32Array}
        |{kind: 'json'; values: Data[]};

export interface Line {
  id: RawUuid;
  data: Data;
  geometryByteLength: number;
  geometryOffset: number;
  // Mercator, which is what the location querier hit tests in and what the hover highlight repushes
  // through LineProgram.
  points: Float64Array;
  // What drew it, so the highlight can size itself against it and putting it back after a hover
  // does not have to guess.
  style: LineStyle;
}

export interface LineGeometry {
  bounds: {box: Rect; margin: number};
  geometryByteLength: number;
  geometryOffset: number;
  instanceCount: number;
  vertexCount: number;
  z: number;
}

export interface Point {
  id: RawUuid;
  data: Data;
  // where the point is in the cell's geometry buffer, so hovering can hide and restore it
  geometryByteLength: number;
  geometryOffset: number;
  // in mercator
  position: Vec2;
  style: PointStyle;
}

// We draw a point as a zero length line, which LineProgram draws as a circle. See also
// feature_layer.ts#ShapeBatch.push.
export interface PointGeometry {
  bounds: {box: Rect; margin: number};
  geometryByteLength: number;
  geometryOffset: number;
  instanceCount: number;
  vertexCount: number;
  z: number;
}

export interface Polygon {
  id: RawUuid;
  // For the location querier, which indexes objects by bound and only decodes what a query hits.
  bound: LatLngRect;
  data: Data;
  geometryByteLength: number;
  // relative the start of the polygon geometry
  geometryOffset: number;
  indexCount: number;
  // relative the start of the polygon indices
  indexOffset: number;
  raw: ArrayBuffer;
  triangles: Triangles;
  // Closed mercator rings of the boundary, so a hover can outline it without the main thread
  // decoding the polygon again. Float32 because that is what projectS2Loop hands back and what the
  // vertex buffer holds, and a state forest runs to thousands of rings.
  outline: Float32Array[];
  style: PolygonStyle;
}

export interface PolygonGeometry {
  geometryByteLength: number;
  geometryOffset: number;
  indexCount: number;
  indexOffset: number;
  z: number;
}

export type Response = LoadResponse;

export type Data = {[key: string]: boolean|number|string};

const TEXT_DECODER = new TextDecoder();

// Tracks the bounding box of a group of lines so that Planner can skip the group when it's off
// screen. The margin is how far a line can draw past its points: its radius plus a pixel for the
// cap's antialiased edge.
class Bounds {
  private lowX = Infinity;
  private lowY = Infinity;
  private highX = -Infinity;
  private highY = -Infinity;
  private margin = 0;

  add(points: ArrayLike<number>, radius: number): void {
    for (let i = 0; i < points.length; i += 2) {
      this.lowX = Math.min(this.lowX, points[i]);
      this.lowY = Math.min(this.lowY, points[i + 1]);
      this.highX = Math.max(this.highX, points[i]);
      this.highY = Math.max(this.highY, points[i + 1]);
    }
    this.margin = Math.max(this.margin, radius + 1);
  }

  done(): {box: Rect; margin: number} {
    return {
      box: {low: [this.lowX, this.lowY], high: [this.highX, this.highY]},
      margin: this.margin,
    };
  }
}

// Writes LineProgram shapes one after another and draws each run of them sharing a z as one
// instanced call. Fill, stroke, radius, and pattern are baked into the vertex stride, so only z
// splits a run.
class InstancedRuns {
  private z: number|undefined = undefined;
  private start: number;
  private instances = 0;
  private vertexCount = 0;
  private bounds = new Bounds();

  constructor(
      private readonly buffer: ArrayBuffer,
      // in floats
      private offset: number,
      private readonly runs: LineGeometry[]) {
    this.start = offset;
  }

  // A style without a pattern is a point.
  push(
      z: number,
      style: {fill: RgbaU32; stroke: RgbaU32; radius: number; pattern?: LinePattern},
      points: ArrayLike<number>): {geometryByteLength: number; geometryOffset: number} {
    if (z !== this.z) {
      this.flush();
      this.z = z;
    }
    const pattern = style.pattern ?? 'solid';
    this.bounds.add(points, pattern === 'ticks' ? 3 * style.radius : style.radius);
    const geometryOffset = 4 * this.offset;
    const result =
        LineProgram.push(
            style.fill, style.stroke, style.radius, pattern, points, this.buffer, geometryOffset);
    this.offset += result.geometryByteLength / 4;
    this.instances += result.instanceCount;
    this.vertexCount = result.vertexCount;
    return {geometryByteLength: result.geometryByteLength, geometryOffset};
  }

  /** Closes the last run and returns the float offset after everything written. */
  done(): number {
    this.flush();
    return this.offset;
  }

  private flush(): void {
    if (this.z !== undefined && this.instances > 0) {
      this.runs.push({
        bounds: this.bounds.done(),
        geometryByteLength: 4 * (this.offset - this.start),
        geometryOffset: 4 * this.start,
        instanceCount: this.instances,
        vertexCount: this.vertexCount,
        z: this.z,
      });
    }
    this.start = this.offset;
    this.instances = 0;
    this.bounds = new Bounds();
  }
}

// Each object draws with the first rule whose filters match it.
class RulesStyler implements Styler {

  constructor(private readonly style: Style) {}

  line(data: Data, styleZoom: number): LineStyle|undefined {
    return findZoomedStyle(data, styleZoom, this.style.lines);
  }

  point(data: Data): PointStyle|undefined {
    return findStyle(data, this.style.points);
  }

  polygon(data: Data): PolygonStyle|undefined {
    return findStyle(data, this.style.polygons);
  }
}

class CollectionLoader {

  // Mercator points of the cell being decoded, kept between loads so that each worker grows it to
  // its biggest cell once
  private points = new Float64Array(1 << 18);
  private styler: Styler;

  constructor(styling: Styling) {
    this.styler = createStyler(styling);
  }

  setStyle(styling: Styling): void {
    this.styler = createStyler(styling);
  }

  private reservePoints(floatCount: number): void {
    if (floatCount <= this.points.length) {
      return;
    }
    let size = this.points.length;
    while (size < floatCount) {
      size *= 2;
    }
    const points = new Float64Array(size);
    points.set(this.points);
    this.points = points;
  }

  load(request: LoadRequest): Reply<Response> {
    const source = new LittleEndianView(request.data);
    const version = source.getVarInt32();
    if (version !== OBJECTS_WIRE_VERSION) {
      throw new Error(`Unhandled version ${version}`);
    }

    const kind = source.getVarInt32();
    if (kind !== KIND_UUID_JSON && kind !== KIND_PACKED_PATH) {
      throw new Error(`Unhandled object kind ${kind}`);
    }

    let lineGeometryBytes = 0;
    let haloGeometryBytes = 0;

    // A cell runs to a hundred thousand lines of a few points each, so we decode them straight into
    // the parallel arrays we send rather than allocating anything per line, or else the garbage
    // collector costs more than the decoding. They are sized for every line and trimmed after.
    const lineCount = source.getVarInt32();
    const ids = new BigInt64Array(2 * lineCount);
    // lsb low, lsb high, msb low, msb high for each line
    const idWords = new Uint32Array(ids.buffer);
    const wayIds = new Float64Array(lineCount);
    const types = new Int32Array(lineCount);
    const traits = new Int32Array(lineCount);
    const values: Data[] = [];
    const lineStyles: LineStyle[] = [];
    // in floats into this.points
    const starts = new Uint32Array(lineCount + 1);
    const terrains = new Uint8Array(lineCount);
    let kept = 0;
    let floatCount = 0;
    // The stylers only read the data they are handed, so every packed path can share this one.
    const packedData = {id: 0, type: 0};
    let packedTraits = 0;
    for (let i = 0; i < lineCount; ++i) {
      let data;
      if (kind === KIND_PACKED_PATH) {
        const pathId = getVarUint53(source);
        idWords[4 * kept + 0] = pathId % 0x1_0000_0000;
        idWords[4 * kept + 1] = pathId / 0x1_0000_0000;
        packedData.id = getVarUint53(source);
        packedData.type = source.getVarInt32();
        packedTraits = source.getVarInt32();
        unpackPathTraits(packedTraits, packedData);
        data = packedData;
      } else {
        for (let j = 0; j < 4; ++j) {
          idWords[4 * kept + j] = source.getUInt32();
        }
        const dataByteSize = source.getVarInt32();
        data = JSON.parse(TEXT_DECODER.decode(source.sliceInt8(dataByteSize)));
      }
      const style = this.styler.line(data, request.styleZoom);
      if (!style) {
        // Deltas have no width to multiply past, so a line the style drops still costs a walk.
        skipE7Deltas(source);
        continue;
      }

      if (kind === KIND_PACKED_PATH) {
        wayIds[kept] = packedData.id;
        types[kept] = packedData.type;
        traits[kept] = packedTraits;
      } else {
        values.push(data);
      }
      lineStyles.push(style);
      terrains[kept] = TERRAINS.indexOf(terrainOf(data));

      const pointCount = source.getVarInt32();
      this.reservePoints(floatCount + 2 * pointCount);
      projectE7DeltasInto(source, pointCount, this.points, floatCount / 2);
      floatCount += 2 * pointCount;
      kept += 1;
      starts[kept] = floatCount;

      lineGeometryBytes += LineProgram.bytesNeeded(pointCount);
      if (style.halo) {
        haloGeometryBytes += LineProgram.bytesNeeded(pointCount);
      }
    }

    // Lines draw in z order so that each z is one instanced call.
    const byZ = [];
    for (let i = 0; i < kept; ++i) {
      byZ.push(i);
    }
    byZ.sort((a, b) => lineStyles[a].z - lineStyles[b].z);

    const polygonCount = source.getVarInt32();
    const triangulated: Array<{
      id: RawUuid;
      bound: LatLngRect;
      data: Data;
      outline: Float32Array[];
      rawPolygon: ArrayBuffer;
      style: PolygonStyle;
      triangles: Triangles;
    }> = [];
    let polygonGeometryFloats = 0;
    let outlineGeometryBytes = 0;
    let indexCount = 0;
    for (let i = 0; i < polygonCount; ++i) {
      const idLsb = source.getBigInt64();
      const idMsb = source.getBigInt64();
      const dataByteSize = source.getVarInt32();
      const data = JSON.parse(TEXT_DECODER.decode(source.sliceInt8(dataByteSize)));
      const polygonByteSize = source.getVarInt32();
      const rawPolygon = source.sliceInt8(polygonByteSize).slice().buffer;
      const polygon = SimpleS2.decodePolygon(rawPolygon);

      const style = this.styler.polygon(data);
      if (!style) {
        continue;
      }

      const triangles = triangulateS2(polygon);
      polygonGeometryFloats += triangles.geometry.length;
      indexCount += triangles.index.length;
      const outline = outlineOf(polygon);
      if (style.outline) {
        for (const ring of outline) {
          outlineGeometryBytes += LineProgram.bytesNeeded(ring.length / 2);
        }
      }

      triangulated.push({
        id: {lsb: idLsb, msb: idMsb},
        bound: latLngBound(polygon),
        data,
        outline,
        rawPolygon,
        style,
        triangles,
      });
    }

    const dotCount = source.getVarInt32();
    const styledPoints: Array<{id: RawUuid; data: Data; position: Vec2; style: PointStyle}> = [];
    for (let i = 0; i < dotCount; ++i) {
      const idLsb = source.getBigInt64();
      const idMsb = source.getBigInt64();
      const dataByteSize = source.getVarInt32();
      const data = JSON.parse(TEXT_DECODER.decode(source.sliceInt8(dataByteSize)));
      const style = this.styler.point(data);
      if (!style) {
        skipE7Deltas(source);
        continue;
      }

      const [x, y] = projectE7Deltas(source);
      styledPoints.push({id: {lsb: idLsb, msb: idMsb}, data, position: [x, y], style});
    }
    styledPoints.sort((a, b) => a.style.z - b.style.z);

    triangulated.sort((a, b) => {
      if (a.style.z !== b.style.z) {
        return a.style.z - b.style.z;
      } else {
        return a.style.fill - b.style.fill;
      }
    });

    const merged = [];
    let last = 0;
    for (let i = 1; i < triangulated.length; ++i) {
      if (triangulated[last].style.fill === triangulated[i].style.fill) {
        continue;
      }

      merged.push(triangulated.slice(last, i));
      last = i;
    }
    if (triangulated.length > 0) {
      merged.push(triangulated.slice(last, triangulated.length));
    }

    // Geometry layout: lines first, then points, then a fill float per polygon group, then polygon
    // vertices, then polygon outlines, then line halos.
    const pointGeometryBytes = styledPoints.length * LineProgram.bytesNeeded(2);
    const geometry =
        new Float32Array(
            (lineGeometryBytes + pointGeometryBytes + outlineGeometryBytes + haloGeometryBytes) / 4
                + merged.length
                + polygonGeometryFloats);
    const geometryUints = new Uint32Array(geometry.buffer);
    const index = new Uint32Array(indexCount);
    let geometryOffset = 0;
    let indexOffset = 0;

    const styles = [...new Set(lineStyles)];
    const lines: LoadedLines = {
      ids: ids.slice(0, 2 * kept),
      data:
          kind === KIND_PACKED_PATH
              ? {
                kind: 'packed_path',
                ids: wayIds.slice(0, kept),
                types: types.slice(0, kept),
                traits: traits.slice(0, kept),
              }
              : {kind: 'json', values},
      geometryByteLengths: new Uint32Array(kept),
      geometryOffsets: new Uint32Array(kept),
      points: this.points.slice(0, floatCount),
      starts: starts.slice(0, kept + 1),
      styleIndices: new Uint16Array(kept),
      styles,
      terrains: terrains.slice(0, kept),
    };

    const response: LoadResponse = {
      kind: 'lr',
      key: request.key,
      styleZoom: request.styleZoom,
      styleEpoch: request.styleEpoch,
      tolerance: request.tolerance,
      geometry: geometry.buffer,
      index: index.buffer,
      lines,
      lineGeometries: [],
      points: [],
      pointGeometries: [],
      polygons: [],
      polygonGeometries: [],
    };

    const lineRuns = new InstancedRuns(geometry.buffer, geometryOffset, response.lineGeometries);
    // Indexed because for-of here allocates for every line.
    for (let k = 0; k < byZ.length; ++k) {
      const i = byZ[k];
      const style = lineStyles[i];
      const result = lineRuns.push(style.z, style, lines.points.subarray(starts[i], starts[i + 1]));
      lines.geometryByteLengths[i] = result.geometryByteLength;
      lines.geometryOffsets[i] = result.geometryOffset;
      lines.styleIndices[i] = styles.indexOf(style);
    }
    geometryOffset = lineRuns.done();

    // styledPoints is sorted by z too.
    const dotRuns = new InstancedRuns(geometry.buffer, geometryOffset, response.pointGeometries);
    for (const point of styledPoints) {
      const [x, y] = point.position;
      const result = dotRuns.push(point.style.z, point.style, [x, y, x, y]);
      response.points.push({
        id: point.id,
        data: point.data,
        geometryByteLength: result.geometryByteLength,
        geometryOffset: result.geometryOffset,
        position: point.position,
        style: point.style,
      });
    }
    geometryOffset = dotRuns.done();

    for (const group of merged) {
      const geometryStart = geometryOffset;
      const indexStart = indexOffset;

      geometryUints[geometryOffset] = group[0].style.fill;
      geometryOffset += 1;

      for (const polygon of group) {
        const {data, outline, rawPolygon, style, triangles} = polygon;
        geometry.set(triangles.geometry, geometryOffset);
        for (let i = 0; i < triangles.index.length; ++i) {
          index[indexOffset + i] = triangles.index[i] + (geometryOffset - geometryStart - 1) / 2;
        }

        response.polygons.push({
          id: polygon.id,
          bound: polygon.bound,
          data,
          geometryByteLength: 4 * triangles.geometry.length,
          geometryOffset: 4 * geometryOffset,
          indexCount: triangles.index.length,
          indexOffset,
          outline,
          raw: rawPolygon,
          style,
          triangles,
        });

        geometryOffset += triangles.geometry.length;
        indexOffset += triangles.index.length;
      }

      response.polygonGeometries.push({
        geometryByteLength: 4 * (geometryOffset - geometryStart),
        geometryOffset: 4 * geometryStart,
        indexCount: indexOffset - indexStart,
        indexOffset: 4 * indexStart,
        z: group[0].style.z,
      });
    }

    // triangulated is sorted by fill z, not outline z, so a run may hold fewer outlines than it
    // could.
    const outlineRuns = new InstancedRuns(geometry.buffer, geometryOffset, response.lineGeometries);
    for (const {outline, style} of triangulated) {
      const line = style.outline;
      if (line) {
        for (const ring of outline) {
          outlineRuns.push(line.z, line, ring);
        }
      }
    }
    geometryOffset = outlineRuns.done();

    const haloRuns = new InstancedRuns(geometry.buffer, geometryOffset, response.lineGeometries);
    for (let k = 0; k < byZ.length; ++k) {
      const i = byZ[k];
      const halo = lineStyles[i].halo;
      if (halo) {
        haloRuns.push(
            halo.z,
            {fill: halo.fill, stroke: halo.fill, radius: halo.radius, pattern: 'solid'},
            lines.points.subarray(starts[i], starts[i + 1]));
      }
    }
    haloRuns.done();

    return {
      message: response,
      transfer: [
        geometry.buffer,
        index.buffer,
        lines.ids.buffer,
        lines.geometryByteLengths.buffer,
        lines.geometryOffsets.buffer,
        lines.points.buffer,
        lines.starts.buffer,
        lines.styleIndices.buffer,
        lines.terrains.buffer,
        ...(lines.data.kind === 'packed_path'
            ? [lines.data.ids.buffer, lines.data.types.buffer, lines.data.traits.buffer]
            : []),
      ],
    };
  }
}

serveClients<Initialize, Request, Response>(init => {
  const loader = new CollectionLoader(init.styling);
  return request => {
    if (request.kind === 'lr') {
      return loader.load(request);
    } else if (request.kind === 'sr') {
      loader.setStyle(request.styling);
      return undefined;
    } else {
      throw checkExhaustive(request);
    }
  };
});

// projectS2Loop drops the repeated first vertex and splits a loop that crosses the antimeridian,
// so each piece has to be closed again or the outline is missing its last edge.
function outlineOf(polygon: S2Polygon): Float32Array[] {
  const loops = polygon.getLoops();
  const rings: Float32Array[] = [];
  for (let i = 0; i < loops.size(); ++i) {
    const {splits, vertices} = projectS2Loop(loops.getAtIndex(i));
    let start = 0;
    for (const split of splits) {
      const ring = new Float32Array(split - start + 2);
      ring.set(vertices.subarray(start, split));
      ring[split - start + 0] = vertices[start + 0];
      ring[split - start + 1] = vertices[start + 1];
      rings.push(ring);
      start = split;
    }
  }
  return rings;
}

// Paths carry their way category, so waterways route as water, lifts as aerial, and the rest as
// land. Only the lifts in RIDDEN_AERIALWAYS get here, because we drop lines OSM_WAYS doesn't style.
// Objects without a category, like a user's own lines, are any kind.
function terrainOf(data: Data): Terrain|undefined {
  const type = data.type;
  if (typeof type !== 'number') {
    return undefined;
  }
  if (aDescendsB(type, WayCategory.WATERWAY)) {
    return 'water';
  }
  if (aDescendsB(type, WayCategory.AERIALWAY)) {
    return 'aerial';
  }
  return 'land';
}

// Path and way ids pass 2^31 but stay far below 2^53, so a double holds them exactly and we skip
// the BigInt allocation that reading a 64 bit varint costs on every byte.
function getVarUint53(source: LittleEndianView): number {
  let value = 0;
  let scale = 1;
  let byte;
  do {
    byte = source.getUInt8();
    value += (byte & 0x7f) * scale;
    scale *= 128;
  } while ((byte & 0x80) !== 0);
  return value;
}

function latLngBound(polygon: S2Polygon): LatLngRect {
  const bound = polygon.getRectBound();
  const low = bound.lo();
  const high = bound.hi();
  return {
    low: [low.latDegrees(), low.lngDegrees()],
    high: [high.latDegrees(), high.lngDegrees()],
  } as const as LatLngRect;
}

function createStyler(styling: Styling): Styler {
  switch (styling.kind) {
    case 'rules':
      return new RulesStyler(styling.style);
    case 'schema':
      return new SchemaStyler(styling.schema);
    default:
      throw checkExhaustive(styling);
  }
}

function findStyle<S extends {filters: Match[]}>(data: Data, styles: S[]): S|undefined {
  for (const style of styles) {
    if (matches(data, style.filters)) {
      return style;
    }
  }
  return undefined;
}

function findZoomedStyle<S extends {filters: Match[]; minZoom: number; maxZoom: number}>(
    data: Data, styleZoom: number, styles: S[]): S|undefined {
  for (const style of styles) {
    if (style.minZoom <= styleZoom && styleZoom < style.maxZoom && matches(data, style.filters)) {
      return style;
    }
  }
  return undefined;
}

