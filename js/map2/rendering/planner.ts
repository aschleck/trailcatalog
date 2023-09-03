import { Disposable } from 'js/common/disposable';

import { Vec2 } from '../common/types';

import { BillboardProgram } from './billboard_program';
import { Drawable, Program, ProgramData } from './program';
import { Renderer } from './renderer';

export class Planner extends Disposable {

  readonly billboardProgram: BillboardProgram;
  private readonly drawables: Drawable[];

  constructor(private readonly renderer: Renderer) {
    super();
    this.billboardProgram = new BillboardProgram(this.renderer);
    this.registerDisposable(this.billboardProgram);
    this.drawables = [];
  }

  add(drawables: Drawable[]): void {
    for (const drawable of drawables) {
      this.drawables.push(drawable);
    }
  }

  clear(): void {
    this.drawables.length = 0;
  }

  render(area: Vec2, centerPixels: Vec2[], worldRadius: number): void {
    if (this.drawables.length === 0) {
      return;
    }

    this.drawables.sort((a, b) => {
      if (a.z !== b.z) {
        return a.z - b.z;
      } else if (a.program.id !== b.program.id) {
        return a.program.id - b.program.id;
      } else {
        // TODO: yolo
        // return a.geometryOffset - b.geometryOffset;
        return 0;
      }
    });

    let drawStart = this.drawables[0];
    let drawStartIndex = 0;
    // Gather sequential drawables that share the same program and draw them all at once
    for (let i = 1; i < this.drawables.length; ++i) {
      const drawable = this.drawables[i];
      if (drawStart.program === drawable.program) {
        continue;
      }

      drawStart.program.render(
          this.drawables.slice(drawStartIndex, i),
          area,
          centerPixels,
          worldRadius);
      drawStart = drawable;
      drawStartIndex = i;
    }

    // The last batch didn't actually draw, so draw it
    drawStart.program.render(
        this.drawables.slice(drawStartIndex, this.drawables.length),
        area,
        centerPixels,
        worldRadius);
  }
}
