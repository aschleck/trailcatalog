import { checkExhaustive } from 'external/dev_april_corgi+/js/common/asserts';
import { LittleEndianView } from 'external/dev_april_corgi+/js/common/little_endian_view';

import { aDescendsB, WayCategory } from 'java/org/trailcatalog/models/categories';

import { S2Polygon } from 'java/org/trailcatalog/s2';
import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';
import { projectE7Deltas, projectS2Loop, skipE7Deltas } from 'js/map/camera';
import { LatLngRect, RawUuid, RgbaU32, Vec2 } from 'js/map/common/types';
import { LineProgram, Stipple } from 'js/map/rendering/line_program';
import { Reply, serveClients } from 'js/map/workers/client_pool';
import { PackedLines } from 'js/map/workers/location_querier';
import { Terrain, TERRAINS } from 'js/map/workers/path_router';
import { CellKey } from 'js/map/workers/s2_data_fetcher';
import { Triangles } from 'js/map/workers/triangulate';
import { triangulateS2 } from 'js/map/workers/triangulate_s2';
import { Z_USER_DATA } from 'js/map/z';

import { Match, matches } from './filters';

export interface Initialize {
  style: Style;
}

interface SetStyleRequest {
  kind: 'sr';
  style: Style;
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
  stroke: RgbaU32;
  radius: number;
  stipple: Stipple;
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

// We draw a point as a zero length line with LineCapProgram, which draws a circle at each end of a
// line, so we get one circle. See also feature_layer.ts#ShapeBatch.push.
export interface PointGeometry {
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

class CollectionLoader {

  constructor(private style: Style) {}

  setStyle(style: Style): void {
    this.style = style;
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
      const style = findZoomedStyle(data, request.styleZoom, this.style.lines);
      if (!style) {
        // Deltas have no width to multiply past, so a line the style drops still costs a walk.
        skipE7Deltas(source);
        continue;
      }

      const points = projectE7Deltas(source);

      lineGeometryBytes += LineProgram.bytesNeeded(points.length / 2);

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
    let indexCount = 0;
    for (let i = 0; i < polygonCount; ++i) {
      const idLsb = source.getBigInt64();
      const idMsb = source.getBigInt64();
      const dataByteSize = source.getVarInt32();
      const data = JSON.parse(TEXT_DECODER.decode(source.sliceInt8(dataByteSize)));
      const polygonByteSize = source.getVarInt32();
      const rawPolygon = source.sliceInt8(polygonByteSize).slice().buffer;
      const polygon = SimpleS2.decodePolygon(rawPolygon);

      const style = findStyle(data, this.style.polygons);
      if (!style) {
        continue;
      }

      const triangles = triangulateS2(polygon);
      polygonGeometryFloats += triangles.geometry.length;
      indexCount += triangles.index.length;

      triangulated.push({
        id: {lsb: idLsb, msb: idMsb},
        bound: latLngBound(polygon),
        data,
        outline: outlineOf(polygon),
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
      const style = findStyle(data, this.style.points);
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
    // vertices.
    const pointGeometryBytes = styledPoints.length * LineProgram.bytesNeeded(2);
    const geometry =
        new Float32Array(
            (lineGeometryBytes + pointGeometryBytes) / 4 + merged.length + polygonGeometryFloats);
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

    // Fill, stroke, radius, and stipple are baked into the vertex stride, so every line sharing a z
    // draws as one instanced call. styledLines is sorted by z, so a group ends when z changes.
    let groupZ: number|undefined = undefined;
    let groupStart = 0;
    let groupInstances = 0;
    let groupVertexCount = 0;
    let pointOffset = 0;
    for (let i = 0; i < styledLines.length; ++i) {
      const line = styledLines[i];
      if (groupZ !== undefined && line.style.z !== groupZ) {
        response.lineGeometries.push({
          geometryByteLength: 4 * (geometryOffset - groupStart),
          geometryOffset: 4 * groupStart,
          instanceCount: groupInstances,
          vertexCount: groupVertexCount,
          z: groupZ,
        });
        groupStart = geometryOffset;
        groupInstances = 0;
        groupVertexCount = 0;
      }
      groupZ = line.style.z;

      const result = LineProgram.push(
          line.style.fill,
          line.style.stroke,
          line.style.radius,
          line.style.stipple,
          line.points,
          geometry.buffer,
          4 * geometryOffset);
      lines.ids[2 * i + 0] = line.id.lsb;
      lines.ids[2 * i + 1] = line.id.msb;
      if (lines.data.kind === 'packed_path') {
        lines.data.ids[i] = line.data.id as number;
        lines.data.types[i] = line.data.type as number;
      } else {
        lines.data.values.push(line.data);
      }
      lines.geometryByteLengths[i] = result.geometryByteLength;
      lines.geometryOffsets[i] = 4 * geometryOffset;
      lines.points.set(line.points, pointOffset);
      lines.starts[i] = pointOffset;
      lines.styleIndices[i] = styles.indexOf(line.style);
      lines.terrains[i] = TERRAINS.indexOf(terrainOf(line.data));
      pointOffset += line.points.length;
      geometryOffset += result.geometryByteLength / 4;
      groupInstances += result.instanceCount;
      groupVertexCount = result.vertexCount;
    }
    lines.starts[styledLines.length] = pointOffset;
    if (groupZ !== undefined && groupInstances > 0) {
      response.lineGeometries.push({
        geometryByteLength: 4 * (geometryOffset - groupStart),
        geometryOffset: 4 * groupStart,
        instanceCount: groupInstances,
        vertexCount: groupVertexCount,
        z: groupZ,
      });
    }

    // Points with the same z draw in one instanced call, like the lines
    let dotZ: number|undefined = undefined;
    let dotStart = geometryOffset;
    let dotInstances = 0;
    let dotVertexCount = 0;
    const flushDots = () => {
      if (dotZ !== undefined && dotInstances > 0) {
        response.pointGeometries.push({
          geometryByteLength: 4 * (geometryOffset - dotStart),
          geometryOffset: 4 * dotStart,
          instanceCount: dotInstances,
          vertexCount: dotVertexCount,
          z: dotZ,
        });
      }
      dotStart = geometryOffset;
      dotInstances = 0;
    };
    for (const point of styledPoints) {
      if (point.style.z !== dotZ) {
        flushDots();
        dotZ = point.style.z;
      }
      const [x, y] = point.position;
      const result = LineProgram.push(
          point.style.fill,
          point.style.stroke,
          point.style.radius,
          /* stipple= */ false,
          [x, y, x, y],
          geometry.buffer,
          4 * geometryOffset);
      response.points.push({
        id: point.id,
        data: point.data,
        geometryByteLength: result.geometryByteLength,
        geometryOffset: 4 * geometryOffset,
        position: point.position,
        style: point.style,
      });
      geometryOffset += result.geometryByteLength / 4;
      dotInstances += result.instanceCount;
      dotVertexCount = result.vertexCount;
    }
    flushDots();

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
        z: Z_USER_DATA,
      });
    }

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
  const loader = new CollectionLoader(init.style);
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

