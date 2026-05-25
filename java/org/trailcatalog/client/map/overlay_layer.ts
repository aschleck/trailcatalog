import { S2LatLng, S2Polygon } from 'java/org/trailcatalog/s2';
import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';
import { projectS2LatLng, projectS2Loop } from 'js/map/camera';
import { LatLng, RgbaU32, Vec2 } from 'js/map/common/types';
import { Layer } from 'js/map/layer';
import { BillboardProgram } from 'js/map/rendering/billboard_program';
import { LineProgram } from 'js/map/rendering/line_program';
import { Planner } from 'js/map/rendering/planner';
import { Drawable } from 'js/map/rendering/program';
import { Renderer } from 'js/map/rendering/renderer';
import { TexturePool } from 'js/map/rendering/texture_pool';

import { BOUNDARY_PALETTE } from './colors';

export interface Overlays {
  bear?: LatLng;
  blueDot?: LatLng;
  polygon?: S2Polygon;
}

const BOUNDARY_RADIUS_PX = 3;
const NO_OFFSET: Vec2 = [0, 0];

export class OverlayLayer extends Layer {

  private readonly buffer: WebGLBuffer;
  private bearIcon: WebGLTexture|undefined;
  private blueIcon: WebGLTexture|undefined;
  private generation: number;
  private plan: {generation: number; drawables: Drawable[]};
  private lastOverlays: Overlays;
  private scratchBuffer: ArrayBuffer;

  constructor(overlays: Overlays, private readonly renderer: Renderer) {
    super();
    this.buffer = this.renderer.createDataBuffer(0);
    this.registerDisposer(() => { this.renderer.deleteBuffer(this.buffer); });
    this.generation = 0;
    this.plan = {
      generation: -1,
      drawables: [],
    };
    this.lastOverlays = {};
    this.scratchBuffer = new ArrayBuffer(64 * 1024);

    fetch("/static/images/icons/bear-face.png")
        .then(response => {
          if (response.ok) {
            return response.blob()
                .then(blob => createImageBitmap(blob))
                .then(bitmap => {
                  const pool = new TexturePool(renderer);
                  this.bearIcon = pool.acquire();
                  renderer.uploadTexture(bitmap, this.bearIcon);
                });
          } else {
            return undefined;
          }
        });

    fetch("/static/images/icons/blue-dot.png")
        .then(response => {
          if (response.ok) {
            return response.blob()
                .then(blob => createImageBitmap(blob))
                .then(bitmap => {
                  const pool = new TexturePool(renderer);
                  this.blueIcon = pool.acquire();
                  renderer.uploadTexture(bitmap, this.blueIcon);
                });
          } else {
            return undefined;
          }
        });

    this.setOverlay(overlays);
  }

  setOverlay(overlays: Overlays) {
    if (overlays.bear === this.lastOverlays.bear
        && overlays.blueDot === this.lastOverlays.blueDot
        && overlays.polygon === this.lastOverlays.polygon) {
      return;
    }
    this.lastOverlays = overlays;

    const projectedLoops: Array<{splits: number[]; vertices: Float32Array}> = [];
    let bufferSize = 0;
    if (overlays.bear && this.bearIcon) {
      bufferSize += BillboardProgram.bytesNeeded();
    }
    if (overlays.blueDot && this.blueIcon) {
      bufferSize += BillboardProgram.bytesNeeded();
    }
    if (overlays.polygon) {
      for (let l = 0; l < overlays.polygon.numLoops(); ++l) {
        const projected = projectS2Loop(overlays.polygon.loop(l));
        projectedLoops.push(projected);
        let last = 0;
        for (const i of projected.splits) {
          // Each split is closed by appending the first vertex, giving
          // (i - last) / 2 + 1 vertices in the polyline.
          bufferSize += LineProgram.bytesNeeded((i - last) / 2 + 1);
          last = i;
        }
      }
    }

    if (bufferSize > this.scratchBuffer.byteLength) {
      const capacity = Math.pow(2, Math.ceil(Math.log2(bufferSize)) + 1);
      this.scratchBuffer = new ArrayBuffer(capacity);
    }
    const buffer = this.scratchBuffer;
    const drawables = [];
    let offset = 0;

    // TODO(april): need to have listeners for icon loads or else this can get lost
    if (overlays.bear && this.bearIcon) {
      const center = projectS2LatLng(S2LatLng.fromDegrees(overlays.bear[0], overlays.bear[1]));
      const {byteSize, drawable} =
          this.renderer.billboardProgram.plan(
              center,
              NO_OFFSET,
              /* size= */ [32, 32],
              /* angle= */ 0,
              0xFFFFFFFF as RgbaU32,
              /* z= */ 120,
              /* atlasIndex= */ 0,
              /* atlasSize= */ [1, 1],
              buffer,
              offset,
              this.buffer,
              this.bearIcon);
      drawables.push(drawable);
      offset += byteSize;
    }

    // TODO(april): need to have listeners for icon loads or else this can get lost
    if (overlays.blueDot && this.blueIcon) {
      const center =
          projectS2LatLng(S2LatLng.fromDegrees(overlays.blueDot[0], overlays.blueDot[1]));
      const {byteSize, drawable} =
          this.renderer.billboardProgram.plan(
              center,
              NO_OFFSET,
              /* size= */ [16, 16],
              /* angle= */ 0,
              0xFFFFFFFF as RgbaU32,
              /* z= */ 120,
              /* atlasIndex= */ 0,
              /* atlasSize= */ [1, 1],
              buffer,
              offset,
              this.buffer,
              this.blueIcon);
      drawables.push(drawable);
      offset += byteSize;
    }

    for (const {splits, vertices} of projectedLoops) {
      let last = 0;
      for (const i of splits) {
        const connected = new Float32Array(i - last + 2);
        connected.set(vertices.subarray(last, last + i - last), 0);
        connected[i - last + 0] = connected[0];
        connected[i - last + 1] = connected[1];
        const drawable =
            this.renderer.lineProgram.plan(
                BOUNDARY_PALETTE.fill,
                BOUNDARY_PALETTE.stroke,
                /* radius= */ 3,
                /* stipple= */ false,
                /* z= */ 105,
                connected,
                buffer,
                offset,
                this.buffer);
        offset += drawable.geometryByteLength;
        drawables.push(drawable);
        drawables.push({
          ...drawable,
          program: this.renderer.lineCapProgram,
        });
        last = i;
      }
    }

    this.renderer.uploadData(buffer, offset, this.buffer);
    this.plan = {
      generation: this.generation + 1,
      drawables,
    };
  }

  override render(planner: Planner): void {
    planner.add(this.plan.drawables);
    this.generation = this.plan.generation;
  }

  override hasNewData(): boolean {
    return this.generation !== this.plan.generation;
  }
}

