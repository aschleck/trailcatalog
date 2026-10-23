import { checkExhaustive } from 'external/dev_april_corgi+/js/common/asserts';
import { LittleEndianView } from 'external/dev_april_corgi+/js/common/little_endian_view';

import { aDescendsB, WayCategory } from 'java/org/trailcatalog/models/categories';

import { S2Polygon } from 'java/org/trailcatalog/s2';
import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';
import { projectE7Deltas, projectS2Loop, skipE7Deltas } from 'js/map/camera';
import { LatLngRect, RawUuid, Rect, RgbaU32, Vec2 } from 'js/map/common/types';
import { LinePattern, LineProgram } from 'js/map/rendering/line_program';
import { Reply, serveClients } from 'js/map/workers/client_pool';
import { PackedLines } from 'js/map/workers/location_querier';
import { Terrain, TERRAINS } from 'js/map/workers/path_router';
import { CellKey } from 'js/map/workers/s2_data_fetcher';
import { Triangles } from 'js/map/workers/triangulate';
import { triangulateS2 } from 'js/map/workers/triangulate_s2';
import { Z_USER_DATA_HALO } from 'js/map/z';

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
  // A wider solid line drawn under this one at Z_USER_DATA_HALO
  halo?: {fill: RgbaU32; radius: number};
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
    {kind: 'packed_path'; ids: Float64Array; types: Int32Array}|{kind: 'json'; values: Data[]};

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

// Keep in sync with ApiServer.kt#KIND_UUID_JSON.
const KIND_UUID_JSON = 0;
const KIND_PACKED_PATH = 1;

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

  private styler: Styler;

  constructor(styling: Styling) {
    this.styler = createStyler(styling);
  }

  setStyle(styling: Styling): void {
    this.styler = createStyler(styling);
  }

  load(request: LoadRequest): Reply<Response> {
    const source = new LittleEndianView(request.data);
    // We still accept version 2 because browsers cache public collection tiles forever, see
    // ApiServer.kt#setCacheHeadersAndCheckNotModified. Version 2 is version 3 without points.
    const version = source.getVarInt32();
    if (version !== 2 && version !== 3) {
      throw new Error("Unhandled version");
    }

    const kind = source.getVarInt32();
    if (kind !== KIND_UUID_JSON && kind !== KIND_PACKED_PATH) {
      throw new Error(`Unhandled object kind ${kind}`);
    }

    let lineGeometryBytes = 0;
    let haloGeometryBytes = 0;

    const lineCount = source.getVarInt32();
    const styledLines: Array<{
      id: RawUuid;
      data: Data;
      style: LineStyle;
      points: Float64Array;
    }> = [];
    for (let i = 0; i < lineCount; ++i) {
      let idLsb;
      let idMsb;
      let data;
      if (kind === KIND_PACKED_PATH) {
        idLsb = source.getVarBigInt64();
        idMsb = 0n;
        // Keep the way id a number the way the jsonb one was. They reach only about 1.3e9.
        data = {id: Number(source.getVarBigInt64()), type: source.getVarInt32()};
      } else {
        idLsb = source.getBigInt64();
        idMsb = source.getBigInt64();
        const dataByteSize = source.getVarInt32();
        data = JSON.parse(TEXT_DECODER.decode(source.sliceInt8(dataByteSize)));
      }
      const style = this.styler.line(data, request.styleZoom);
      if (!style) {
        // Deltas have no width to multiply past, so a line the style drops still costs a walk.
        skipE7Deltas(source);
        continue;
      }

      const points = projectE7Deltas(source);

      lineGeometryBytes += LineProgram.bytesNeeded(points.length / 2);
      if (style.halo) {
        haloGeometryBytes += LineProgram.bytesNeeded(points.length / 2);
      }

      styledLines.push({id: {lsb: idLsb, msb: idMsb}, data, style, points});
    }

    styledLines.sort((a, b) => a.style.z - b.style.z);

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

    const dotCount = version >= 3 ? source.getVarInt32() : 0;
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

    let pointCount = 0;
    for (const line of styledLines) {
      pointCount += line.points.length;
    }
    const styles = [...new Set(styledLines.map(line => line.style))];
    const lines: LoadedLines = {
      ids: new BigInt64Array(2 * styledLines.length),
      data:
          kind === KIND_PACKED_PATH
              ? {
                kind: 'packed_path',
                ids: new Float64Array(styledLines.length),
                types: new Int32Array(styledLines.length),
              }
              : {kind: 'json', values: []},
      geometryByteLengths: new Uint32Array(styledLines.length),
      geometryOffsets: new Uint32Array(styledLines.length),
      points: new Float64Array(pointCount),
      starts: new Uint32Array(styledLines.length + 1),
      styleIndices: new Uint16Array(styledLines.length),
      styles,
      terrains: new Uint8Array(styledLines.length),
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

    // styledLines is sorted by z, so each z draws as one instanced call.
    const lineRuns = new InstancedRuns(geometry.buffer, geometryOffset, response.lineGeometries);
    let pointOffset = 0;
    for (let i = 0; i < styledLines.length; ++i) {
      const line = styledLines[i];
      const result = lineRuns.push(line.style.z, line.style, line.points);
      lines.ids[2 * i + 0] = line.id.lsb;
      lines.ids[2 * i + 1] = line.id.msb;
      if (lines.data.kind === 'packed_path') {
        lines.data.ids[i] = line.data.id as number;
        lines.data.types[i] = line.data.type as number;
      } else {
        lines.data.values.push(line.data);
      }
      lines.geometryByteLengths[i] = result.geometryByteLength;
      lines.geometryOffsets[i] = result.geometryOffset;
      lines.points.set(line.points, pointOffset);
      lines.starts[i] = pointOffset;
      lines.styleIndices[i] = styles.indexOf(line.style);
      lines.terrains[i] = TERRAINS.indexOf(terrainOf(line.data));
      pointOffset += line.points.length;
    }
    lines.starts[styledLines.length] = pointOffset;
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
    for (const {points, style} of styledLines) {
      const halo = style.halo;
      if (halo) {
        haloRuns.push(
            Z_USER_DATA_HALO,
            {fill: halo.fill, stroke: halo.fill, radius: halo.radius, pattern: 'solid'},
            points);
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
            ? [lines.data.ids.buffer, lines.data.types.buffer]
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

