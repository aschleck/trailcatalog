import { checkState } from 'external/dev_april_corgi+/js/common/asserts';

import { Vec2 } from '../common/types';

export function cropLine(geometry: number[], starts: number[], extent: number, loop: boolean):
    [number[], number[]] {
  const cGeometry = [];
  const cStarts = [];
  for (let i = 0; i < starts.length; ++i) {
    const start = starts[i];
    const end = i < starts.length - 1 ? starts[i + 1] : geometry.length;

    let outside = true;
    let lastPushedX = undefined;
    let lastPushedY = undefined;
    for (let i = start; i < end; i += 2) {
      const px = geometry[i + 0];
      const py = geometry[i + 1];

      if ((px >= 0 && px < extent) && (py >= 0 && py < extent)) {
        const runStart = cGeometry.length;
        if (i > start && outside) {
          const lx = geometry[i - 2 + 0];
          const ly = geometry[i - 2 + 1];
          checkState(intersectFiniteTile(lx, ly, px, py, extent));
          const ix = SEGMENT_HIT[1];
          const iy = SEGMENT_HIT[2];
          if (ix !== lastPushedX || iy !== lastPushedY) {
            cGeometry.push(ix, iy);
            lastPushedX = ix;
            lastPushedY = iy;
          }
        }

        if (px !== lastPushedX || py !== lastPushedY) {
          cGeometry.push(px, py);
          lastPushedX = px;
          lastPushedY = py;
        }
        // A line that leaves and reenters at the same edge point continues the previous run, or
        // else it starts an empty one and MbtileLoader#load sizes it at -1 segments.
        if (outside && cGeometry.length > runStart) {
          cStarts.push(runStart);
        }
        outside = false;
      } else {
        if (i > start) {
          const lx = geometry[i - 2 + 0];
          const ly = geometry[i - 2 + 1];

          if (outside) {
            const crossings = intersectInfiniteTile(lx, ly, px, py, extent);
            let started = false;
            for (let j = 0; j < crossings; ++j) {
              const ix = TILE_CROSSINGS[3 * j + 1];
              const iy = TILE_CROSSINGS[3 * j + 2];
              if (!(0 <= ix && ix <= extent && 0 <= iy && iy <= extent)) {
                continue;
              }

              if (ix !== lastPushedX || iy !== lastPushedY) {
                if (!started) {
                  cStarts.push(cGeometry.length);
                  started = true;
                }

                cGeometry.push(ix, iy);
                lastPushedX = ix;
                lastPushedY = iy;
              }
            }
          } else {
            checkState(intersectFiniteTile(lx, ly, px, py, extent));
            const ix = SEGMENT_HIT[1];
            const iy = SEGMENT_HIT[2];
            if (ix !== lastPushedX || iy !== lastPushedY) {
              cGeometry.push(ix, iy);
              lastPushedX = undefined;
              lastPushedY = undefined;
            }
          }
        }

        outside = true;
      }
    }

    // Also check for intersections on the way back to the start point
    if (loop) {
      const px = geometry[start + 0];
      const py = geometry[start + 1];

      if ((px >= 0 && px < extent) && (py >= 0 && py < extent)) {
        if (outside) {
          const lx = geometry[end - 2 + 0];
          const ly = geometry[end - 2 + 1];
          checkState(intersectFiniteTile(lx, ly, px, py, extent));
          const ix = SEGMENT_HIT[1];
          const iy = SEGMENT_HIT[2];
          const runStart = cGeometry.length;
          if (ix !== lastPushedX || iy !== lastPushedY) {
            cGeometry.push(ix, iy);
          }
          if (px !== lastPushedX || py !== lastPushedY) {
            cGeometry.push(px, py);
          }
          if (cGeometry.length > runStart) {
            cStarts.push(runStart);
          }
        } else {
          if (px !== lastPushedX || py !== lastPushedY) {
            cGeometry.push(px, py);
          }
        }
      } else {
        const lx = geometry[end - 2 + 0];
        const ly = geometry[end - 2 + 1];

        if (outside) {
          const crossings = intersectInfiniteTile(lx, ly, px, py, extent);
          let started = false;
          for (let j = 0; j < crossings; ++j) {
            const ix = TILE_CROSSINGS[3 * j + 1];
            const iy = TILE_CROSSINGS[3 * j + 2];
            if (!(0 <= ix && ix <= extent && 0 <= iy && iy <= extent)) {
              continue;
            }

            if (ix !== lastPushedX || iy !== lastPushedY) {
              if (!started) {
                cStarts.push(cGeometry.length);
                started = true;
              }

              cGeometry.push(ix, iy);
              lastPushedX = ix;
              lastPushedY = iy;
            }
          }
        } else {
          checkState(intersectFiniteTile(lx, ly, px, py, extent));
          const ix = SEGMENT_HIT[1];
          const iy = SEGMENT_HIT[2];
          if (ix !== lastPushedX || iy !== lastPushedY) {
            cGeometry.push(ix, iy);
            lastPushedX = undefined;
            lastPushedY = undefined;
          }
        }
      }
    }
  }

  return [cGeometry, cStarts];
}

// Sutherland-Hodgman polygon clipping against the tile rectangle [0, extent] x [0, extent].
export function cropPolygon(geometry: number[], starts: number[], extent: number, loop: boolean):
    [number[], number[]] {
  const cGeometry: number[] = [];
  const cStarts: number[] = [];
  let buf: number[] = [];
  let next: number[] = [];

  for (let r = 0; r < starts.length; ++r) {
    const start = starts[r];
    const end = r < starts.length - 1 ? starts[r + 1] : geometry.length;
    if (end - start < 4) {
      continue;
    }

    buf.length = 0;
    for (let i = start; i < end; i += 2) {
      buf.push(geometry[i + 0], geometry[i + 1]);
    }

    for (let edge = 0; edge < 4; ++edge) {
      next.length = 0;
      const n = buf.length;
      if (n === 0) {
        break;
      }

      let px = buf[n - 2];
      let py = buf[n - 1];
      let pIn = isInside(px, py, edge, extent);
      for (let i = 0; i < n; i += 2) {
        const cx = buf[i + 0];
        const cy = buf[i + 1];
        const cIn = isInside(cx, cy, edge, extent);

        if (cIn) {
          if (!pIn) {
            const [ix, iy] = intersectEdge(px, py, cx, cy, edge, extent);
            next.push(ix, iy);
          }
          next.push(cx, cy);
        } else if (pIn) {
          const [ix, iy] = intersectEdge(px, py, cx, cy, edge, extent);
          next.push(ix, iy);
        }

        px = cx;
        py = cy;
        pIn = cIn;
      }

      const tmp = buf;
      buf = next;
      next = tmp;
    }

    if (buf.length >= 6) {
      cStarts.push(cGeometry.length);
      for (let i = 0; i < buf.length; ++i) {
        cGeometry.push(buf[i]);
      }
    }
  }

  return [cGeometry, cStarts];
}

function isInside(x: number, y: number, edge: number, extent: number): boolean {
  switch (edge) {
    case 0: return x >= 0;
    case 1: return x <= extent;
    case 2: return y >= 0;
    case 3: return y <= extent;
    default: throw new Error(`bad edge ${edge}`);
  }
}

function intersectEdge(
    x1: number, y1: number, x2: number, y2: number, edge: number, extent: number): Vec2 {
  switch (edge) {
    case 0: {
      const t = -x1 / (x2 - x1);
      return [0, y1 + t * (y2 - y1)];
    }
    case 1: {
      const t = (extent - x1) / (x2 - x1);
      return [extent, y1 + t * (y2 - y1)];
    }
    case 2: {
      const t = -y1 / (y2 - y1);
      return [x1 + t * (x2 - x1), 0];
    }
    case 3: {
      const t = (extent - y1) / (y2 - y1);
      return [x1 + t * (x2 - x1), extent];
    }
    default: throw new Error(`bad edge ${edge}`);
  }
}

// intersectSegments writes t, x, and y here, and intersectInfiniteTile its crossings, so that
// cropLine doesn't allocate for every vertex outside the tile.
const SEGMENT_HIT = new Float64Array(3);
const TILE_CROSSINGS = new Float64Array(4 * 3);

/** Writes the first crossing of the tile's sides into SEGMENT_HIT, returning false if none. */
function intersectFiniteTile(
    x1: number, y1: number, x2: number, y2: number, extent: number): boolean {
  return intersectSegments(x1, y1, x2, y2, 0, 0, 0, extent)
      || intersectSegments(x1, y1, x2, y2, 0, extent, extent, extent)
      || intersectSegments(x1, y1, x2, y2, extent, extent, extent, 0)
      || intersectSegments(x1, y1, x2, y2, extent, 0, 0, 0);
}

/**
 * Writes the crossings of the lines through the tile's sides into TILE_CROSSINGS as t, x, y in
 * order of t, returning how many there are.
 */
function intersectInfiniteTile(
    x1: number, y1: number, x2: number, y2: number, extent: number): number {
  const huge = 1024 * extent;

  let count = 0;
  if (intersectSegments(x1, y1, x2, y2, -huge, 0, huge, 0)) {
    count = insertCrossing(count);
  }
  if (intersectSegments(x1, y1, x2, y2, extent, -huge, extent, huge)) {
    count = insertCrossing(count);
  }
  if (intersectSegments(x1, y1, x2, y2, huge, extent, -huge, extent)) {
    count = insertCrossing(count);
  }
  if (intersectSegments(x1, y1, x2, y2, 0, huge, 0, -huge)) {
    count = insertCrossing(count);
  }
  return count;
}

// Inserts SEGMENT_HIT by t, after any crossing with an equal t so those keep their side order.
function insertCrossing(count: number): number {
  let i = count;
  for (; i > 0 && TILE_CROSSINGS[3 * (i - 1)] > SEGMENT_HIT[0]; --i) {
    TILE_CROSSINGS.copyWithin(3 * i, 3 * (i - 1), 3 * i);
  }
  TILE_CROSSINGS.set(SEGMENT_HIT, 3 * i);
  return count + 1;
}

function intersectSegments(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    x3: number,
    y3: number,
    x4: number,
    y4: number): boolean {
  const tn = (x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4);
  const td = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (td === 0) {
    return false;
  }
  const t = tn / td;

  const un = (x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3);
  const ud = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (ud === 0) {
    return false;
  }
  const u = -un / ud;

  if (0 <= t && t <= 1 && 0 <= u && u <= 1) {
    SEGMENT_HIT[0] = t;
    SEGMENT_HIT[1] = x1 + t * (x2 - x1);
    SEGMENT_HIT[2] = y1 + t * (y2 - y1);
    return true;
  } else {
    return false;
  }
}

