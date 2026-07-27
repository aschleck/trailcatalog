import { checkExhaustive } from 'external/dev_april_corgi+/js/common/asserts';
import { LittleEndianView } from 'external/dev_april_corgi+/js/common/little_endian_view';

import { S2Polygon } from 'java/org/trailcatalog/s2';
import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';
import { projectE7Array } from 'js/map/camera';
import { LatLngRect, RawUuid, RgbaU32 } from 'js/map/common/types';
import { LineProgram } from 'js/map/rendering/line_program';
import { CellKey } from 'js/map/workers/s2_data_fetcher';
import { Triangles } from 'js/map/workers/triangulate';
import { triangulateS2 } from 'js/map/workers/triangulate_s2';
import { Z_USER_DATA } from 'js/map/z';

interface InitializeRequest {
  kind: 'ir';
  style: Style;
}

interface Style {
  lines: LineStyle[];
  polygons: PolygonStyle[];
}

interface LineStyle {
  filters: Match[];
  fill: RgbaU32;
  stroke: RgbaU32;
  radius: number;
  stipple: boolean;
  z: number;
}

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
  key: CellKey;
  data: ArrayBuffer;
}

export type Request = InitializeRequest|LoadRequest;

export interface LoadResponse {
  kind: 'lr';
  key: CellKey;
  geometry: ArrayBuffer;
  index: ArrayBuffer;
  // We merge multiple objects into the *Geometry version, so if we want just the geometry of any
  // one object then we keep the non-*Geometry arrays too.
  lines: Line[];
  lineGeometries: LineGeometry[];
  polygons: Polygon[];
  polygonGeometries: PolygonGeometry[];
}

export interface Line {
  id: RawUuid;
  data: Data;
  geometryByteLength: number;
  geometryOffset: number;
  // Mercator, which is what the location querier hit tests in and what the hover highlight repushes
  // through LineProgram.
  points: Float64Array;
}

export interface LineGeometry {
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

class CollectionLoader {

  constructor(
      private readonly style: Style,
      private readonly postMessage: (response: Response, transfer?: Transferable[]) => void,
  ) {}

  load(request: LoadRequest) {
    const source = new LittleEndianView(request.data);
    const version = source.getVarInt32();
    if (version !== 1) {
      throw new Error("Unhandled version");
    }

    let lineGeometryBytes = 0;

    const lineCount = source.getVarInt32();
    const styledLines: Array<{
      id: RawUuid;
      data: Data;
      fill: RgbaU32;
      stroke: RgbaU32;
      radius: number;
      stipple: boolean;
      points: Float64Array;
      z: number;
    }> = [];
    for (let i = 0; i < lineCount; ++i) {
      const idLsb = source.getBigInt64();
      const idMsb = source.getBigInt64();
      const dataByteSize = source.getVarInt32();
      const data = JSON.parse(TEXT_DECODER.decode(source.sliceInt8(dataByteSize)));
      const linePointCount = source.getVarInt32();
      source.align(4);
      const latLngDegrees = source.sliceInt32(linePointCount * 2);

      const style = findStyle(data, this.style.lines);
      if (!style) {
        continue;
      }

      const points = projectE7Array(latLngDegrees);
      lineGeometryBytes += LineProgram.bytesNeeded(points.length / 2);

      styledLines.push({
        id: {lsb: idLsb, msb: idMsb},
        data,
        fill: style.fill,
        stroke: style.stroke,
        radius: style.radius,
        stipple: style.stipple,
        points,
        z: style.z,
      });
    }

    styledLines.sort((a, b) => a.z - b.z);

    const polygonCount = source.getVarInt32();
    const triangulated: Array<{
      id: RawUuid;
      bound: LatLngRect;
      data: Data;
      fill: RgbaU32;
      rawPolygon: ArrayBuffer;
      triangles: Triangles;
      z: number;
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
        fill: style.fill,
        rawPolygon,
        triangles,
        z: style.z,
      });
    }

    triangulated.sort((a, b) => {
      if (a.z !== b.z) {
        return a.z - b.z;
      } else {
        return a.fill - b.fill;
      }
    });

    const merged = [];
    let last = 0;
    for (let i = 1; i < triangulated.length; ++i) {
      if (triangulated[last].fill === triangulated[i].fill) {
        continue;
      }

      merged.push(triangulated.slice(last, i));
      last = i;
    }
    if (triangulated.length > 0) {
      merged.push(triangulated.slice(last, triangulated.length));
    }

    // Geometry layout: lines first, then a fill float per polygon group, then polygon vertices.
    const geometry =
        new Float32Array(lineGeometryBytes / 4 + merged.length + polygonGeometryFloats);
    const geometryUints = new Uint32Array(geometry.buffer);
    const index = new Uint32Array(indexCount);
    let geometryOffset = 0;
    let indexOffset = 0;

    const response: LoadResponse = {
      kind: 'lr',
      key: request.key,
      geometry: geometry.buffer,
      index: index.buffer,
      lines: [],
      lineGeometries: [],
      polygons: [],
      polygonGeometries: [],
    };

    // Fill, stroke, radius, and stipple are baked into the vertex stride, so every line sharing a z
    // draws as one instanced call. styledLines is sorted by z, so a group ends when z changes.
    let groupZ: number|undefined = undefined;
    let groupStart = 0;
    let groupInstances = 0;
    let groupVertexCount = 0;
    for (const line of styledLines) {
      if (groupZ !== undefined && line.z !== groupZ) {
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
      groupZ = line.z;

      const result = LineProgram.push(
          line.fill,
          line.stroke,
          line.radius,
          line.stipple,
          line.points,
          geometry.buffer,
          4 * geometryOffset);
      response.lines.push({
        id: line.id,
        data: line.data,
        geometryByteLength: result.geometryByteLength,
        geometryOffset: 4 * geometryOffset,
        points: line.points,
      });
      geometryOffset += result.geometryByteLength / 4;
      groupInstances += result.instanceCount;
      groupVertexCount = result.vertexCount;
    }
    if (groupZ !== undefined && groupInstances > 0) {
      response.lineGeometries.push({
        geometryByteLength: 4 * (geometryOffset - groupStart),
        geometryOffset: 4 * groupStart,
        instanceCount: groupInstances,
        vertexCount: groupVertexCount,
        z: groupZ,
      });
    }

    for (const group of merged) {
      const geometryStart = geometryOffset;
      const indexStart = indexOffset;

      geometryUints[geometryOffset] = group[0].fill;
      geometryOffset += 1;

      for (const polygon of group) {
        const {data, rawPolygon, triangles} = polygon;
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
          raw: rawPolygon,
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

    this.postMessage(response, [geometry.buffer, index.buffer]);
  }
}

function start(ir: InitializeRequest) {
  const fetcher = new CollectionLoader(ir.style, (self as any).postMessage.bind(self));
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

function matches(data: Data, filters: Match[]): boolean {
  for (const filter of filters) {
    switch (filter.match) {
      case "string_equals": return data[filter.key] === filter.value;
      case "always": return true;
    }
  }
  return false;
}

