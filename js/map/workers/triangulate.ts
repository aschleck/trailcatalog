import earcut from 'earcut';

import { checkExists } from 'external/dev_april_corgi+/js/common/asserts';

export interface Triangles {
  geometry: ArrayLike<number>;
  index: number[];
}

export interface Ring {
  begin: number;
  end: number;
  area: number;
  bboxMinX: number;
  bboxMinY: number;
  bboxMaxX: number;
  bboxMaxY: number;
}

// Mercator polygons arrive from two places with different ideas about how a polygon is spelled:
// mbtiles hand over flat rings whose winding says which are shells, S2 hands over loops that know.
// Both reduce to "a vertex buffer, a list of shell rings, and a list of hole rings", which is what
// triangulateRings takes. The S2 half lives in triangulate_s2.ts so that nothing here has to pull
// in the J2CL geometry bundle.

export function triangulateMb(
  geometry: number[],
  starts: number[],
  maxTriangleLengthMeters: number,
): Triangles {
  // MVT winds shells clockwise in tile coordinates, and projectLayer has since flipped y, so shells
  // are the rings with positive area here.
  const rings = ringsFrom(geometry, starts);
  return triangulateRings(
      geometry,
      rings.filter(r => r.area > 0),
      rings.filter(r => r.area < 0),
      maxTriangleLengthMeters);
}

// Signed area of a ring, doubled and negated — only the sign and relative magnitude matter to
// callers. Exported because mbtile_loader needs the same notion of winding while it is still in
// tile coordinates, where y points down and so the sign is the other way around.
export function ringArea(geometry: ArrayLike<number>, begin: number, end: number): number {
  let area = 0;
  for (let i = begin + 2; i < end; i += 2) {
    area += (geometry[i] - geometry[i - 2]) * (geometry[i - 1] + geometry[i + 1]);
  }
  return area + (geometry[begin] - geometry[end - 2]) * (geometry[end - 1] + geometry[begin + 1]);
}

// Rings are implicitly closed runs of the vertex buffer, each starting where `starts` says and
// ending where the next one begins. Drops rings that can't contribute a triangle.
export function ringsFrom(geometry: number[], starts: number[]): Ring[] {
  const rings: Ring[] = [];
  for (let i = 0; i < starts.length; ++i) {
    const begin = starts[i];
    const end = i < starts.length - 1 ? starts[i + 1] : geometry.length;
    if (end - begin < 6) {
      continue;
    }

    const area = ringArea(geometry, begin, end);
    if (area === 0) {
      continue;
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let j = begin; j < end; j += 2) {
      const x = geometry[j];
      const y = geometry[j + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    rings.push({begin, end, area, bboxMinX: minX, bboxMinY: minY, bboxMaxX: maxX, bboxMaxY: maxY});
  }
  return rings;
}

function pointInRing(geometry: number[], ring: Ring, x: number, y: number): boolean {
  let inside = false;
  let jx = geometry[ring.end - 2];
  let jy = geometry[ring.end - 1];
  for (let i = ring.begin; i < ring.end; i += 2) {
    const ix = geometry[i];
    const iy = geometry[i + 1];
    if (((iy > y) !== (jy > y))
        && x < (jx - ix) * (y - iy) / (jy - iy) + ix) {
      inside = !inside;
    }
    jx = ix;
    jy = iy;
  }
  return inside;
}

export function triangulateRings(
  geometry: number[],
  exteriors: Ring[],
  holes: Ring[],
  maxTriangleLengthMeters: number,
): Triangles {
  if (exteriors.length === 0) {
    return {geometry: [], index: []};
  }

  // Assign each hole to the smallest-area exterior that contains it. Without this, holes get
  // attached to the nearest exterior in input order, which can leave earcut producing overlapping
  // triangles when one feature contains multiple polygons.
  const holesByExterior = new Map<Ring, Ring[]>();
  for (const e of exteriors) {
    holesByExterior.set(e, []);
  }
  for (const hole of holes) {
    const hx = geometry[hole.begin];
    const hy = geometry[hole.begin + 1];
    let best: Ring | undefined;
    let bestArea = Infinity;
    for (const e of exteriors) {
      if (hx < e.bboxMinX || hx > e.bboxMaxX || hy < e.bboxMinY || hy > e.bboxMaxY) {
        continue;
      }
      if (!pointInRing(geometry, e, hx, hy)) {
        continue;
      }
      if (e.area < bestArea) {
        best = e;
        bestArea = e.area;
      }
    }
    if (best !== undefined) {
      checkExists(holesByExterior.get(best)).push(hole);
    }
  }

  // earcut wants one exterior at a time, with its holes appended to the same buffer, so we hand it
  // a compacted copy per exterior and map the indices it returns back to the shared buffer.
  const allIndices: number[] = [];
  for (const exterior of exteriors) {
    const vertices: number[] = [];
    const originalIndices: number[] = [];
    const holeStarts: number[] = [];

    for (let j = exterior.begin; j < exterior.end; j += 2) {
      vertices.push(geometry[j], geometry[j + 1]);
      originalIndices.push(j / 2);
    }
    for (const hole of checkExists(holesByExterior.get(exterior))) {
      holeStarts.push(vertices.length / 2);
      for (let j = hole.begin; j < hole.end; j += 2) {
        vertices.push(geometry[j], geometry[j + 1]);
        originalIndices.push(j / 2);
      }
    }

    for (const i of earcut(vertices, holeStarts)) {
      allIndices.push(originalIndices[i]);
    }
  }

  const maxLengthRadians = maxTriangleLengthMeters / 6371010;
  return subdivideBigTriangles(geometry, allIndices, maxLengthRadians * maxLengthRadians);
}

function subdivideBigTriangles(
  geometry: number[],
  indices: number[],
  maxLengthRadiansSq: number,
): Triangles {
  const out: number[] = [];
  // One entry per edge already cut, so the triangle on the other side reuses that vertex rather
  // than adding a second one in the same spot.
  const splitByEdge = new Map<number, number>();

  // Index of the vertex cutting edge (iA, iB) in two. Down the middle for a general edge, but edges
  // running exactly along a mercator axis are cut on a shared grid — see canonicalBetween.
  function splitEdge(iA: number, iB: number): number {
    const key = pair(iA, iB);
    const cached = splitByEdge.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const aX = geometry[2 * iA];
    const aY = geometry[2 * iA + 1];
    const bX = geometry[2 * iB];
    const bY = geometry[2 * iB + 1];
    const index = geometry.length / 2;
    if (aY === bY) {
      geometry.push(canonicalBetween(aX, bX), aY);
    } else if (aX === bX) {
      geometry.push(aX, canonicalBetween(aY, bY));
    } else {
      geometry.push((aX + bX) / 2, (aY + bY) / 2);
    }
    splitByEdge.set(key, index);
    return index;
  }

  // Emit (a, b, c), first cutting it up if any edge covers enough ground that drawing it straight
  // would visibly leave the globe. Where an edge gets cut depends only on its endpoints, so the two
  // triangles sharing it always agree and the mesh comes out free of T-junctions.
  function emit(a: number, b: number, c: number): void {
    const aLng = Math.PI * geometry[2 * a];
    const aLat = unprojectLat(geometry[2 * a + 1]);
    const bLng = Math.PI * geometry[2 * b];
    const bLat = unprojectLat(geometry[2 * b + 1]);
    const cLng = Math.PI * geometry[2 * c];
    const cLat = unprojectLat(geometry[2 * c + 1]);

    const abTooLong = approxRadiansBetweenSq(aLat, aLng, bLat, bLng) > maxLengthRadiansSq;
    const bcTooLong = approxRadiansBetweenSq(bLat, bLng, cLat, cLng) > maxLengthRadiansSq;
    const caTooLong = approxRadiansBetweenSq(cLat, cLng, aLat, aLng) > maxLengthRadiansSq;

    if (!abTooLong && !bcTooLong && !caTooLong) {
      // earcut mostly winds counter-clockwise but not always, and CULL_FACE is on, so flip the ones
      // that came out backwards.
      if (signedArea2(geometry, a, b, c) < 0) {
        out.push(a, b, c);
      } else {
        out.push(c, b, a);
      }
    } else if (abTooLong && bcTooLong && caTooLong) {
      const ab = splitEdge(a, b);
      const bc = splitEdge(b, c);
      const ca = splitEdge(c, a);
      emit(a, ab, ca);
      emit(ab, b, bc);
      emit(bc, c, ca);
      emit(ab, bc, ca);
    } else if (abTooLong && bcTooLong) {
      const ab = splitEdge(a, b);
      const bc = splitEdge(b, c);
      emit(a, ab, c);
      emit(ab, bc, c);
      emit(ab, b, bc);
    } else if (abTooLong && caTooLong) {
      const ab = splitEdge(a, b);
      const ca = splitEdge(c, a);
      emit(a, ab, ca);
      emit(ab, b, c);
      emit(ca, c, ab);
    } else if (bcTooLong && caTooLong) {
      const bc = splitEdge(b, c);
      const ca = splitEdge(c, a);
      emit(a, b, ca);
      emit(b, bc, ca);
      emit(bc, c, ca);
    } else if (abTooLong) {
      const ab = splitEdge(a, b);
      emit(a, ab, c);
      emit(ab, b, c);
    } else if (bcTooLong) {
      const bc = splitEdge(b, c);
      emit(a, b, bc);
      emit(a, bc, c);
    } else {
      const ca = splitEdge(c, a);
      emit(a, b, ca);
      emit(b, c, ca);
    }
  }

  for (let i = 0; i < indices.length; i += 3) {
    emit(indices[i], indices[i + 1], indices[i + 2]);
  }

  return {geometry, index: out};
}

// Tile boundaries are axis-aligned lines in mercator space, and they are the only lines two
// independently triangulated meshes ever share. Each mesh arrives at such a line with whatever
// edges its own triangulation happened to leave there: earcut discards collinear vertices when it
// gets stuck, so one tile can show up with a single edge spanning the whole boundary while its
// neighbor shows up with eight. On the globe every edge is drawn as a 3D chord, so edges of
// different lengths sag away from the true parallel by different amounts and a hairline of clear
// color opens along the seam.
//
// Cutting an axis-aligned edge on a grid shared by everyone, rather than at its own midpoint, makes
// the tessellation of the line a function of position alone — every mesh touching it converges on
// the same vertices however it got there. Powers of two are the right grid because tile boundaries
// sit at multiples of 2^-(zoom-1) in mercator space, so they are on it at every zoom and neighbors
// drawn from different zooms agree too.
//
// Returns the coarsest multiple of a power of two lying strictly between a and b.
function canonicalBetween(a: number, b: number): number {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  // Once step drops below the gap, the first multiple above lo is below hi, so this terminates for
  // any lo < hi. Callers only split edges longer than the max triangle length, so it exits early.
  for (let step = 1; ; step /= 2) {
    const candidate = (Math.floor(lo / step) + 1) * step;
    if (candidate < hi) {
      return candidate;
    }
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

// ringArea for a triangle whose three vertices are anywhere in the buffer, so it carries the same
// sign convention: positive winds clockwise in screen space.
function signedArea2(g: ArrayLike<number>, a: number, b: number, c: number): number {
  return (g[2 * a] - g[2 * c]) * (g[2 * a + 1] + g[2 * c + 1])
      + (g[2 * b] - g[2 * a]) * (g[2 * b + 1] + g[2 * a + 1])
      + (g[2 * c] - g[2 * b]) * (g[2 * c + 1] + g[2 * b + 1]);
}

// Map non-negative pairs of integers to non-negative integers. pair(a, b) = pair(b, a)
function pair(a: number, b: number): number {
  let max = Math.max(a, b);
  let min = Math.min(a, b);
  return max * (max + 1) / 2 + min;
}
