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
