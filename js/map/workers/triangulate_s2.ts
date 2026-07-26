// The S2 front end for the triangulator. Separate from triangulate.ts so that the mercator side
// stays free of the J2CL geometry bundle, which only loads once esbuild has bundled it.
import { S2Loop, S2Polygon } from 'java/org/trailcatalog/s2';

import { projectS2Loop } from '../camera';

import { ringsFrom, Triangles, triangulateRings } from './triangulate';

export function triangulateS2(polygon: S2Polygon): Triangles {
  const loopList = polygon.getLoops();
  const loops = [];
  for (let i = 0; i < loopList.size(); ++i) {
    loops.push(loopList.getAtIndex(i));
  }

  // Project shells first and holes after, so one offset tells them apart once they're rings. A loop
  // crossing the antimeridian projects to several disjoint rings, which is what projectS2Loop's
  // splits mark out.
  const geometry: number[] = [];
  const starts: number[] = [];
  const append = (loop: S2Loop) => {
    const {splits, vertices} = projectS2Loop(loop);
    let start = 0;
    for (const split of splits) {
      starts.push(geometry.length);
      for (let i = start; i < split; ++i) {
        geometry.push(vertices[i]);
      }
      start = split;
    }
  };
  for (const loop of loops) {
    if (!loop.isHole()) {
      append(loop);
    }
  }
  const holesBegin = geometry.length;
  for (const loop of loops) {
    if (loop.isHole()) {
      append(loop);
    }
  }

  const rings = ringsFrom(geometry, starts);
  return triangulateRings(
      geometry,
      rings.filter(r => r.begin < holesBegin),
      rings.filter(r => r.begin >= holesBegin),
      // projectS2Loop already walks every loop in 50 km steps, so no boundary edge is long enough
      // to leave the globe and there is nothing to subdivide. Only earcut's interior edges could
      // still be long, and those don't border anything.
      /* maxTriangleLengthMeters= */ Infinity);
}
