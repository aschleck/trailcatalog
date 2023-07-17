import { checkArgument } from 'js/common/asserts';

import { splitVec2 } from '../common/math';
import { RgbaU32, Vec2 } from '../common/types';
import { Camera } from '../models/camera';

import { BillboardProgram } from './billboard_program';
import { HypsometryProgram } from './hypsometry_program';
import { Line } from './geometry';
import { LineCapProgram } from './line_cap_program';
import { LineProgram } from './line_program';
import { Drawable } from './program';
import { RenderBaker } from './render_baker';
import { Renderer } from './renderer';
import { Glyph, SdfProgram } from './sdf_program';
import { TriangleProgram } from './triangle_program';

const MAX_GEOMETRY_BYTES = 96_000_000;
const MAX_INDEX_BYTES = 16_000_000;

export class RenderPlanner {

  static createPlannerAndPrograms(renderer: Renderer): RenderPlanner {
    return new RenderPlanner(
        renderer,
        new BillboardProgram(renderer.gl),
        new HypsometryProgram(renderer.gl),
        new LineCapProgram(renderer.gl),
        new LineProgram(renderer.gl),
        new SdfProgram(renderer.gl),
        new TriangleProgram(renderer.gl));
  }

  readonly baker: RenderBaker;
  private geometryBuffer: WebGLBuffer;
  private indexBuffer: WebGLBuffer;

  constructor(
    private readonly renderer: Renderer,
    private readonly billboardProgram: BillboardProgram,
    private readonly hypsometryProgram: HypsometryProgram,
    private readonly lineCapProgram: LineCapProgram,
    private readonly lineProgram: LineProgram,
    private readonly sdfProgram: SdfProgram,
    private readonly triangleProgram: TriangleProgram,
  ) {
    this.baker =
        new RenderBaker(
            this.billboardProgram,
            this.hypsometryProgram,
            this.lineCapProgram,
            this.lineProgram,
            this.sdfProgram,
            this.triangleProgram,
            MAX_GEOMETRY_BYTES,
            MAX_INDEX_BYTES);
    this.geometryBuffer = renderer.createDataBuffer(MAX_GEOMETRY_BYTES);
    this.indexBuffer = renderer.createIndexBuffer(MAX_INDEX_BYTES);
  }

  upload(): void {
    const [swapG, swapI] = this.baker.upload(this.renderer, this.geometryBuffer, this.indexBuffer);
  }

  render(area: Vec2, camera: Camera): void {
    this.renderer.render();

    if (this.baker.drawables.length === 0) {
      return;
    }

    const bounds = camera.viewportBounds(area[0], area[1]);

    const centerPixel = camera.centerPixel;
    const centerPixels = [splitVec2(centerPixel)];
    // Add extra camera positions for wrapping the world
    //
    // There's some weird normalization bug at
    // lat=42.3389265&lng=177.6919189&zoom=3.020
    // where tiles don't show up around the wrap. Seems like S2 sometimes normalizes and sometimes
    // doesn't depending on the size of the range. So we check the max/min.
    if (Math.min(bounds.lng().lo(), bounds.lng().hi()) < -Math.PI) {
      centerPixels.push(splitVec2([centerPixel[0] + 2, centerPixel[1]]));
    }
    if (Math.max(bounds.lng().lo(), bounds.lng().hi()) > Math.PI) {
      centerPixels.push(splitVec2([centerPixel[0] - 2, centerPixel[1]]));
    }

    let drawStart = this.baker.drawables[0];
    let drawStartIndex = 0;
    // Gather sequential drawables that share the same program and draw them all at once
    for (let i = 1; i < this.baker.drawables.length; ++i) {
      const drawable = this.baker.drawables[i];
      if (drawStart.program === drawable.program) {
        continue;
      }

      drawStart.program.render(
          area,
          centerPixels,
          camera.worldRadius,
          this.baker.drawables.slice(drawStartIndex, i),
          this.geometryBuffer,
          this.indexBuffer);
      drawStart = drawable;
      drawStartIndex = i;
    }

    // The last batch didn't actually draw, so draw it
    drawStart.program.render(
        area,
        centerPixels,
        camera.worldRadius,
        this.baker.drawables.slice(drawStartIndex, this.baker.drawables.length),
        this.geometryBuffer,
        this.indexBuffer);
  }
}

