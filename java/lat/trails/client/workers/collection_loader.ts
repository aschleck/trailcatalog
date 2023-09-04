import earcut from 'earcut';

import { S2LatLng, S2LatLngRect, S2Polygon } from 'java/org/trailcatalog/s2';
import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';
import { checkExhaustive } from 'js/common/asserts';
import { FetchThrottler } from 'js/common/fetch_throttler';
import { LittleEndianView } from 'js/common/little_endian_view';
import { projectS2Loop } from 'js/map2/camera';
import { RgbaU32, S2CellToken } from 'js/map2/common/types';

interface InitializeRequest {
  kind: 'ir';
}

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
}

export interface Polygon {
  geometryByteLength: number;
  geometryOffset: number;
  indexCount: number;
  indexOffset: number;
  z: number;
}

export type Response = LoadResponse;

const TEXT_DECODER = new TextDecoder();

class CollectionLoader {

  constructor(
      private readonly postMessage: (response: Response, transfer?: Transferable[]) => void,
  ) {}

  load(request: LoadRequest) {
    const source = new LittleEndianView(request.data);
    const version = source.getVarInt32();
    if (version !== 1) {
      throw new Error("Unhandled version");
    }

    const polygonCount = source.getVarInt32();
    const polygons = [];
    let geometryCount = 0;
    let indexCount = 0;
    for (let i = 0; i < polygonCount; ++i) {
      const idLsb = source.getBigInt64();
      const idMsb = source.getBigInt64();
      const dataByteSize = source.getVarInt32();
      const data = JSON.parse(TEXT_DECODER.decode(source.sliceInt8(dataByteSize)));
      const polygonByteSize = source.getVarInt32();
      const polygon = SimpleS2.decodePolygon(source.sliceInt8(polygonByteSize).slice().buffer);
      const triangulated = triangulate(polygon);
      polygons.push({
        ...triangulated,
        data,
      });
      geometryCount += triangulated.geometry.length;
      indexCount += triangulated.index.length;
    }

    // Add a float per polygon to include the color
    const geometry = new Float32Array(polygons.length + geometryCount);
    const geometryUints = new Uint32Array(geometry.buffer);
    const index = new Uint32Array(indexCount);
    const response: LoadResponse = {
      kind: 'lr',
      token: request.token,
      geometry: geometry.buffer,
      index: index.buffer,
      polygons: [],
    };

    let geometryOffset = 0;
    let indexOffset = 0;
    for (const polygon of polygons) {
      // Push the polygon
      response.polygons.push({
        geometryByteLength: polygon.geometry.byteLength,
        geometryOffset: 4 * geometryOffset,
        indexCount: polygon.index.length,
        indexOffset: 4 * indexOffset,
        z: 1,
      });

      // Add the color
      geometryUints[geometryOffset] = 0xFF0000FF;
      geometryOffset += 1;

      // Add the vertices
      geometry.set(polygon.geometry, geometryOffset);
      index.set(polygon.index, indexOffset);

      geometryOffset += polygon.geometry.length;
      indexOffset += polygon.index.length;
    }

    this.postMessage(response, [geometry.buffer, index.buffer]);
  }
}

function start(ir: InitializeRequest) {
  const fetcher = new CollectionLoader((self as any).postMessage.bind(self));
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

function triangulate(polygon: S2Polygon): {geometry: Float32Array; index: number[];} {
  const loopsList = polygon.getLoops();
  const loops = [];
  for (let i = 0; i < loopsList.size(); ++i) {
    loops.push(loopsList.getAtIndex(i));
  }

  const exteriors = [];
  const holes = [];
  for (const loop of loops) {
    if (loop.isHole()) {
      holes.push(loop);
    } else {
      exteriors.push(loop);
    }
  }

  // Let's play a fun game: https://github.com/mapbox/earcut/issues/161
  // ... so it turns out we need to filter loops by what holes actually intersect.
  const relevantHoles = [];
  for (const exterior of exteriors) {
    const intersecting = [];
    for (let i = 0; i < holes.length; ++i) {
      if (exterior.intersects(holes[i])) {
        intersecting.push(i);
      }
    }
    relevantHoles.push(intersecting);
  }

  // Project all the exteriors. We track the offset because at the end we're going to jam all the
  // exteriors into the same array and we need to know where it will end up.
  let exteriorVertexLength = 0;
  const projectedExteriors = [];
  for (const exterior of exteriors) {
    const projected = projectS2Loop(exterior);
    projectedExteriors.push({
      offset: exteriorVertexLength,
      ...projected,
    });
    exteriorVertexLength += projected.vertices.length;
  }

  // Project all the holes. Track the offset for the same reason as above.
  let holeVertexLength = 0;
  const projectedHoles = [];
  for (const hole of holes) {
    const projected = projectS2Loop(hole);
    projectedHoles.push({
      offset: holeVertexLength,
      ...projected,
    });
    holeVertexLength += projected.vertices.length;
  }

  // We need to earcut *per* split *per* exterior ring. Lord have mercy on us if there's some
  // degenerate nonsense.
  const geometry = new Float32Array(exteriorVertexLength + holeVertexLength);
  let geometryOffset = 0;
  const index = [];
  for (let i = 0; i < projectedExteriors.length; ++i) {
    const {offset, splits, vertices} = projectedExteriors[i];

    // Jam all relevant holes into one buffer. Note that this is not necessarily sufficient to avoid
    // the earcut bug: we may have a multipolygon where the exterior has two disjoint loops (if it
    // crosses the meridian for example) and then there are two disjoint holes.
    let holesToCheck = [];
    let holeSize = 0;
    for (const holeI of relevantHoles[i]) {
      const hole = projectedHoles[holeI];
      holesToCheck.push(hole);
      holeSize += hole.vertices.length;
    }
    const holes = [];
    const holeVertices = new Float32Array(holeSize);
    holeSize = 0;
    for (const {splits, vertices} of holesToCheck) {
      holes.push(holeSize);
      for (const split of splits) {
        holes.push(holeSize + split);
      }
      // earcut doesn't need the last vertex since it assumes everything but the first loop is a
      // hole.
      holes.pop();
      holeVertices.set(vertices, holeSize);
      holeSize += vertices.length;
    }

    // Now we can check each exterior split against the holes.
    let start = 0;
    for (const split of splits) {
      const length = split - start;
      const allVertices = new Float32Array(length + holeSize);
      allVertices.set(vertices.subarray(start, length), 0);
      allVertices.set(holeVertices, length);

      // Figure out the hole positions relative to the loop vertices.
      const offsetHoles = [];
      for (const offset of holes) {
        offsetHoles.push((length + offset) / 2);
      }

      const triangulatedIndices = earcut(allVertices, offsetHoles);
      for (const indice of triangulatedIndices) {
        let trueIndice = -1;
        if (indice < length / 2) {
          trueIndice = (geometryOffset + start) / 2 + indice;
        } else {
          const offsetInHoles = 2 * indice - length;
          let holeOffset = 0;
          for (const {offset, vertices} of holesToCheck) {
            if (offsetInHoles < holeOffset + vertices.length) {
              trueIndice = (exteriorVertexLength + offset + offsetInHoles - holeOffset) / 2;
              break;
            }
            holeOffset += vertices.length;
          }

          if (trueIndice < 0) {
            throw new Error('Failed to find correct hole offset');
          }
        }
        index.push(trueIndice);
      }

      start = split;
    }

    geometry.set(vertices, geometryOffset);
    geometryOffset += vertices.length;
  }

  for (const {vertices} of projectedHoles) {
    geometry.set(vertices, geometryOffset);
    geometryOffset += vertices.length;
  }

  return {
    geometry,
    index,
  };
}

