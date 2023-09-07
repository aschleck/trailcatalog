import earcut from 'earcut';

import { S2Polygon } from 'java/org/trailcatalog/s2';
import { checkExists } from 'js/common/asserts';

import { projectS2Loop } from '../camera';

export interface Triangles {
  geometry: ArrayLike<number>;
  index: number[];
}

export function triangulateMb(geometry: number[], starts: number[]): Triangles {
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
    } else {
      groupedStarts[groupedStarts.length - 1].push(begin);
    }
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

  return {
    geometry,
    index: allIndices,
  };
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

