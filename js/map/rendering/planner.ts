import { Vec2 } from '../common/types';

import { Drawable } from './program';

export class Planner {

  private readonly drawables: Drawable[];

  constructor() {
    this.drawables = [];
  }

  add(drawables: Drawable[]): void {
    for (const drawable of drawables) {
      this.drawables.push(drawable);
    }
  }

  render(
    area: Vec2,
    centerPixel: Vec2,
    flattenFactor: number,
    mvpMatrix: Float32Array,
    worldRadius: number,
  ): void {
    // Skip drawables that are entirely off screen. Layers load geometry well past the edges of the
    // screen so that panning has something to show, and the GPU pays for every vertex whether it's
    // visible or not. This runs every frame against the current camera, so panning never waits on
    // it. We don't cull on the globe because the box test assumes a flat map.
    if (flattenFactor === 1) {
      let kept = 0;
      for (const drawable of this.drawables) {
        if (!drawable.bounds || isOnScreen(drawable.bounds, area, centerPixel, worldRadius)) {
          this.drawables[kept] = drawable;
          kept += 1;
        }
      }
      this.drawables.length = kept;
    }

    if (this.drawables.length === 0) {
      return;
    }

    this.drawables.sort((a, b) => {
      if (a.z !== b.z) {
        return a.z - b.z;
      } else if (a.program.id !== b.program.id) {
        return a.program.id - b.program.id;
      } else if (a.geometry !== b.geometry) {
        return a.geometry < b.geometry ? -1 : 1;
      } else {
        return a.geometryOffset - b.geometryOffset;
      }
    });

    let drawStart = this.drawables[0];
    let drawStartIndex = 0;
    const inverseArea = [1 / area[0], 1 / area[1]] as Vec2;
    // Gather sequential drawables that share the same program and draw them all at once
    for (let i = 1; i < this.drawables.length; ++i) {
      const drawable = this.drawables[i];
      if (drawStart.program === drawable.program) {
        continue;
      }

      drawStart.program.render(
          this.drawables.slice(drawStartIndex, i),
          centerPixel,
          flattenFactor,
          inverseArea,
          mvpMatrix,
          worldRadius);
      drawStart = drawable;
      drawStartIndex = i;
    }

    // The last batch didn't actually draw, so draw it
    drawStart.program.render(
        this.drawables.slice(drawStartIndex, this.drawables.length),
        centerPixel,
        flattenFactor,
        inverseArea,
        mvpMatrix,
        worldRadius);
  }
}

// Checks whether a drawable's box could be on screen, using the same math as line_program.ts. The
// screen extends area / 2 from the camera in each direction, in the same units as halfWorldSize.
function isOnScreen(
    bounds: NonNullable<Drawable['bounds']>,
    area: Vec2,
    centerPixel: Vec2,
    worldRadius: number,
): boolean {
  const {box, margin} = bounds;
  const halfX = area[0] / 2 + margin;
  const halfY = area[1] / 2 + margin;
  const lowY = (box.low[1] - centerPixel[1]) * worldRadius;
  const highY = (box.high[1] - centerPixel[1]) * worldRadius;
  if (highY < -halfY || lowY > halfY) {
    return false;
  }
  // The shaders draw each vertex at whichever copy of the world is closest to the camera, so we
  // test the box where it is and shifted one world left and right. If the box is wider than half
  // the world, a segment might cross the antimeridian and stretch across the whole screen, so we
  // always draw it.
  if (box.high[0] - box.low[0] > 1) {
    return true;
  }
  for (const shift of [0, -2, 2]) {
    const lowX = (box.low[0] + shift - centerPixel[0]) * worldRadius;
    const highX = (box.high[0] + shift - centerPixel[0]) * worldRadius;
    if (highX >= -halfX && lowX <= halfX) {
      return true;
    }
  }
  return false;
}
