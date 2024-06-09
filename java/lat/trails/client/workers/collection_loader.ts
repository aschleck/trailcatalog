import { checkExhaustive } from 'external/dev_april_corgi~/js/common/asserts';
import { LittleEndianView } from 'external/dev_april_corgi~/js/common/little_endian_view';

import { S2Polygon } from 'java/org/trailcatalog/s2';
import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';
import { LatLngRect, RgbaU32, S2CellToken } from 'js/map/common/types';
import { Triangles, triangulateS2 } from 'js/map/workers/triangulate';
import { Z_USER_DATA } from 'js/map/z';

interface InitializeRequest {
  kind: 'ir';
  style: Style;
}

interface Style {
  polygons: PolygonStyle[];
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
  token: S2CellToken;
  data: ArrayBuffer;
}

export type Request = InitializeRequest|LoadRequest;

export interface LoadResponse {
  kind: 'lr';
  token: S2CellToken;
  geometry: ArrayBuffer;
  index: ArrayBuffer;
  polygons: Polygon[];
  polygonalGeometries: PolygonalGeometry[];
}

export interface Polygon {
  data: Data;
  geometryByteLength: number;
  // relative the start of the polygon geometry
  geometryOffset: number;
  indexCount: number;
  // relative the start of the polygon indices
  indexOffset: number;
  s2: ArrayBuffer;
}

export interface PolygonalGeometry {
  geometryByteLength: number;
  geometryOffset: number;
  indexCount: number;
  indexOffset: number;
  z: number;
}

export type Response = LoadResponse;

type Data = {[key: string]: boolean|number|string};

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

    const polygonCount = source.getVarInt32();
    const triangulated: Array<{
      data: Data;
      fill: RgbaU32;
      rawPolygon: ArrayBuffer;
      triangles: Triangles;
      z: number;
    }> = [];
    let geometryCount = 0;
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
      geometryCount += triangles.geometry.length;
      indexCount += triangles.index.length;

      triangulated.push({
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
    merged.push(triangulated.slice(last, triangulated.length));

    // Add a float per color group to include the colors
    const geometry = new Float32Array(merged.length + geometryCount);
    const geometryUints = new Uint32Array(geometry.buffer);
    const index = new Uint32Array(indexCount);
    let geometryOffset = 0;
    let indexOffset = 0;

    const response: LoadResponse = {
      kind: 'lr',
      token: request.token,
      geometry: geometry.buffer,
      index: index.buffer,
      polygons: [],
      polygonalGeometries: [],
    };

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
          data,
          geometryByteLength: 4 * triangles.geometry.length,
          geometryOffset,
          indexCount: triangles.index.length,
          indexOffset,
          s2: rawPolygon,
        });

        geometryOffset += triangles.geometry.length;
        indexOffset += triangles.index.length;
      }

      response.polygonalGeometries.push({
        geometryByteLength: 4 * (geometryOffset - geometryStart),
        geometryOffset: 4 * geometryStart,
        // same here
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

function findStyle(data: Data, styles: PolygonStyle[]): PolygonStyle|undefined {
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

