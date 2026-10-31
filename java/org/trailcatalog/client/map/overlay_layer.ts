import { S2LatLng, S2Polygon, SimpleS2 } from 'java/org/trailcatalog/s2';
import { projectS2LatLng, projectS2Loop } from 'js/map/camera';
import { LatLng, RgbaU32, Vec2 } from 'js/map/common/types';
import { Layer } from 'js/map/layer';
import { BillboardProgram } from 'js/map/rendering/billboard_program';
import { LineProgram } from 'js/map/rendering/line_program';
import { Planner } from 'js/map/rendering/planner';
import { Drawable } from 'js/map/rendering/program';
import { Renderer } from 'js/map/rendering/renderer';

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
  private readonly bearIcon: WebGLTexture;
  private readonly blueIcon: WebGLTexture;
  private readonly loadedIcons: Set<WebGLTexture>;
  private drawables: Drawable[];
  private overlays: Overlays;
  private scratchBuffer: ArrayBuffer;

  constructor(overlays: Overlays, private readonly renderer: Renderer) {
    super();
    this.buffer = this.renderer.createDataBuffer(0);
    this.bearIcon = this.renderer.createTexture();
    this.blueIcon = this.renderer.createTexture();
    this.registerDisposer(() => {
      this.renderer.deleteBuffer(this.buffer);
      this.renderer.deleteTexture(this.bearIcon);
      this.renderer.deleteTexture(this.blueIcon);
    });
    this.loadedIcons = new Set();
    this.drawables = [];
    this.overlays = overlays;
    this.scratchBuffer = new ArrayBuffer(64 * 1024);

    this.loadIcon('images/icons/bear-face.png', this.bearIcon);
    this.loadIcon('images/icons/blue-dot.png', this.blueIcon);
    this.plan();
  }

  setOverlay(overlays: Overlays) {
    if (overlays.bear === this.overlays.bear
        && overlays.blueDot === this.overlays.blueDot
        && overlays.polygon === this.overlays.polygon) {
      return;
    }
    this.overlays = overlays;
    this.plan();
  }

  private loadIcon(path: string, texture: WebGLTexture): void {
    fetch(new URL(path, import.meta.url))
        .then(response => {
          if (response.ok) {
            return response.blob();
          } else {
            throw new Error(`Unable to fetch ${path}`);
          }
        })
        .then(blob => createImageBitmap(blob))
        .then(bitmap => {
          if (this.isDisposed) {
            bitmap.close();
            return;
          }
          this.renderer.uploadTexture(bitmap, texture);
          this.loadedIcons.add(texture);
          this.plan();
        });
  }

  private plan(): void {
    const overlays = this.overlays;
    const bear = overlays.bear && this.loadedIcons.has(this.bearIcon) ? overlays.bear : undefined;
    const blueDot =
        overlays.blueDot && this.loadedIcons.has(this.blueIcon) ? overlays.blueDot : undefined;
    const projectedLoops: Array<{splits: number[]; vertices: Float32Array}> = [];
    let bufferSize = 0;
    if (bear) {
      bufferSize += BillboardProgram.bytesNeeded();
    }
    if (blueDot) {
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

    if (bear) {
      const center = projectS2LatLng(S2LatLng.fromDegrees(bear[0], bear[1]));
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

    if (blueDot) {
      const center = projectS2LatLng(S2LatLng.fromDegrees(blueDot[0], blueDot[1]));
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
                /* pattern= */ 'solid',
                /* z= */ 105,
                connected,
                buffer,
                offset,
                this.buffer);
        offset += drawable.geometryByteLength;
        drawables.push(drawable);
        last = i;
      }
    }

    this.renderer.uploadData(buffer, offset, this.buffer);
    this.drawables = drawables;
    this.redraw();
  }

  override render(planner: Planner): void {
    planner.add(this.drawables);
  }

}

