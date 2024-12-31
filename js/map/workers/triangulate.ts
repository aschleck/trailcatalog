import earcut from 'earcut';

import { S2Polygon } from 'java/org/trailcatalog/s2';
import { checkExists } from 'external/dev_april_corgi~/js/common/asserts';

import { projectS2Loop } from '../camera';

export interface Triangles {
  geometry: ArrayLike<number>;
  index: number[];
}

export function triangulateMb(geometry: number[], starts: number[], maxTriangleLengthMeters?: number): Triangles {
  // We need to figure out what's an exterior and what's a ring. We do so by calculating the sign of
  // the polygon's area.
  starts.push(geometry.length);
  const groupedStarts = [];
  for (let i = 1; i < starts.length; ++i) {
    const begin = starts[i - 1];
    const end = starts[i];

    let area = 0;
    for (let i = begin + 2; i < end; i += 2) {
      area += (geometry[i + 0] - geometry[i - 2]) * (geometry[i - 1] + geometry[i + 1]);
    }
    area +=
        (geometry[begin + 0] - geometry[end - 2])
            * (geometry[end - 1] + geometry[begin + 1]);

    if (area > 0) {
      // close the last exterior group
      if (groupedStarts.length > 0) {
        groupedStarts[groupedStarts.length - 1].push(begin);
      }
      // push on a new exterior ring
      groupedStarts.push([begin]);
    } else if (groupedStarts.length > 0 && area < 0) {
      // if we haven't pushed any starts then there's no point making a hole
      groupedStarts[groupedStarts.length - 1].push(begin);
    }
  }

  if (groupedStarts.length === 0) {
    return {geometry: [], index: []};
  }

  // close the last exterior group
  groupedStarts[groupedStarts.length - 1].push(geometry.length);

  // Earcut each exterior and its holes. We have to do a bunch of indice mapping and unmapping to
  // reuse the geometry.
  const allIndices = [];
  for (const starts of groupedStarts) {
    const begin = checkExists(starts.shift());
    const end = checkExists(starts.pop());
    for (let i = 0; i < starts.length; ++i) {
      starts[i] = (starts[i] - begin) / 2;
    }

    const index = earcut(geometry.slice(begin, end), starts);
    for (const i of index) {
      allIndices.push(begin / 2 + i);
    }
  }

  if (maxTriangleLengthMeters === undefined) {
    return {
      geometry,
      index: allIndices,
    };
  }
  const maxLengthRadians = maxTriangleLengthMeters / 6371010;
  return subdivideBigTriangles(
    geometry,
    allIndices,
    maxLengthRadians * maxLengthRadians,
  );
}

function subdivideBigTriangles(
  geometry: number[],
  indices: number[],
  maxLengthRadiansSq: number
): Triangles {
  const newIndices: number[] = [];
  // Keep track of the triangles we've subdivided so we can reuse the midpoints vertices.
  const midpointIndices = new Map<number, number>();

  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i];
    const i1 = indices[i + 1];
    const i2 = indices[i + 2];

    subdivideTriangleIfBig(i0, i1, i2, geometry, newIndices, midpointIndices, maxLengthRadiansSq);
  }

  return {
    geometry,
    index: newIndices,
  };
}

function subdivideTriangleIfBig(
  a: number,
  b: number,
  c: number,
  geometry: number[],
  indices: number[],
  midpointIndices: Map<number, number>,
  maxLengthRadiansSq: number,
) {
  const lng0 = Math.PI * geometry[2 * a];
  const lat0 = unprojectLat(geometry[2 * a + 1]);
  const lng1 = Math.PI * geometry[2 * b];
  const lat1 = unprojectLat(geometry[2 * b + 1]);
  const lng2 = Math.PI * geometry[2 * c];
  const lat2 = unprojectLat(geometry[2 * c + 1]);

  const d0 = approxRadiansBetweenSq(lat0, lng0, lat1, lng1);
  const d1 = approxRadiansBetweenSq(lat1, lng1, lat2, lng2);
  const d2 = approxRadiansBetweenSq(lat2, lng2, lat0, lng0);

  const edge0TooLong = d0 > maxLengthRadiansSq;
  const edge1TooLong = d1 > maxLengthRadiansSq;
  const edge2TooLong = d2 > maxLengthRadiansSq;

  // If none of the edges are too long, keep the triangle as it is.
  if (!edge0TooLong && !edge1TooLong && !edge2TooLong) {
    indices.push(a, b, c);
    return;
  }

  function getMidpointIndex(iA: number, iB: number): number {
    const key = pair(iA, iB);
    const midpointIndex = midpointIndices.get(key);
    if (midpointIndex !== undefined) {
      return midpointIndex;
    }
    const xMid = (geometry[2 * iA] + geometry[2 * iB]) / 2;
    const yMid = (geometry[2 * iA + 1] + geometry[2 * iB + 1]) / 2;
    const index = geometry.length / 2;
    geometry.push(xMid, yMid);
    midpointIndices.set(key, index);
    return index;
  }

  if (edge0TooLong && edge1TooLong && edge2TooLong) {
    const ab = getMidpointIndex(a, b);
    const bc = getMidpointIndex(b, c);
    const ca = getMidpointIndex(c, a);
    subdivideTriangleIfBig(a, ab, ca, geometry, indices, midpointIndices, maxLengthRadiansSq);
    subdivideTriangleIfBig(ab, b, bc, geometry, indices, midpointIndices, maxLengthRadiansSq);
    subdivideTriangleIfBig(bc, c, ca, geometry, indices, midpointIndices, maxLengthRadiansSq);
    subdivideTriangleIfBig(ab, bc, ca, geometry, indices, midpointIndices, maxLengthRadiansSq);
  } else if (edge0TooLong && edge1TooLong) {
    const ab = getMidpointIndex(a, b);
    const bc = getMidpointIndex(b, c);
    subdivideTriangleIfBig(a, ab, c, geometry, indices, midpointIndices, maxLengthRadiansSq);
    subdivideTriangleIfBig(ab, bc, c, geometry, indices, midpointIndices, maxLengthRadiansSq);
    subdivideTriangleIfBig(ab, b, bc, geometry, indices, midpointIndices, maxLengthRadiansSq);
  } else if (edge0TooLong && edge2TooLong) {
    const ab = getMidpointIndex(a, b);
    const ca = getMidpointIndex(c, a);
    subdivideTriangleIfBig(a, ab, ca, geometry, indices, midpointIndices, maxLengthRadiansSq);
    subdivideTriangleIfBig(ab, b, c, geometry, indices, midpointIndices, maxLengthRadiansSq);
    subdivideTriangleIfBig(ca, c, ab, geometry, indices, midpointIndices, maxLengthRadiansSq);
  } else if (edge1TooLong && edge2TooLong) {
    const bc = getMidpointIndex(b, c);
    const ca = getMidpointIndex(c, a);
    subdivideTriangleIfBig(a, b, ca, geometry, indices, midpointIndices, maxLengthRadiansSq);
    subdivideTriangleIfBig(b, bc, ca, geometry, indices, midpointIndices, maxLengthRadiansSq);
    subdivideTriangleIfBig(bc, c, ca, geometry, indices, midpointIndices, maxLengthRadiansSq);
  } else if (edge0TooLong) {
    const ab = getMidpointIndex(a, b);
    subdivideTriangleIfBig(a, ab, c, geometry, indices, midpointIndices, maxLengthRadiansSq);
    subdivideTriangleIfBig(ab, b, c, geometry, indices, midpointIndices, maxLengthRadiansSq);
  } else if (edge1TooLong) {
    const bc = getMidpointIndex(b, c);
    subdivideTriangleIfBig(a, b, bc, geometry, indices, midpointIndices, maxLengthRadiansSq);
    subdivideTriangleIfBig(a, bc, c, geometry, indices, midpointIndices, maxLengthRadiansSq);
  } else if (edge2TooLong) {
    const ca = getMidpointIndex(c, a);
    subdivideTriangleIfBig(a, b, ca, geometry, indices, midpointIndices, maxLengthRadiansSq);
    subdivideTriangleIfBig(b, c, ca, geometry, indices, midpointIndices, maxLengthRadiansSq);
  } else {
    // Should not reach here
    indices.push(a, b, c);
  }
}

function unprojectLat(y: number): number {
  return Math.asin(Math.tanh(y * Math.PI))
}

// Radians in, radians squared out
function approxRadiansBetweenSq(lat0: number, lng0: number, lat1: number, lng1: number): number {
  const x = (lng1 - lng0) * Math.cos((lat0 + lat1) / 2)
  const y = lat1 - lat0

  return x * x + y * y;
}

// Map non-negative pairs of integers to non-negative integers. pair(a, b) = pair(b, a)
function pair(a: number, b: number): number {
  let max = Math.max(a, b);
  let min = Math.min(a, b);
  return max * (max + 1) / 2 + min;
}

export function triangulateS2(polygon: S2Polygon): Triangles {
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
