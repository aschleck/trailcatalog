import { S2LatLng, S2Polygon } from 'java/org/trailcatalog/s2';
import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';
import { LatLng, Vec2 } from 'js/map/common/types';
import { Layer } from 'js/map/layer';
import { projectS2LatLng, projectS2Loop } from 'js/map/models/camera';
import { Line } from 'js/map/rendering/geometry';
import { RenderBaker } from 'js/map/rendering/render_baker';
import { Renderer } from 'js/map/rendering/renderer';
import { TexturePool } from 'js/map/rendering/texture_pool';

import { BOUNDARY_PALETTE } from './colors';

export interface Overlays {
  point?: LatLng;
  polygon?: S2Polygon;
}

const BOUNDARY_RADIUS_PX = 3;
const NO_OFFSET: Vec2 = [0, 0];

export class OverlayData extends Layer {

  private readonly billboards: Array<{
    center: Vec2;
    size: Vec2;
    texture: WebGLTexture;
  }>;
  private readonly lines: Line[];
  private bearIcon: WebGLTexture|undefined;
  private lastChange: number;

  constructor(overlays: Overlays, renderer: Renderer) {
    super();
    this.billboards = [];
    this.lastChange = Date.now();
    this.lines = [];

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
          }
        });

    this.setOverlay(overlays);
  }

  setOverlay(overlays: Overlays) {
    this.billboards.length = 0;
    // TODO(april): need to have listeners for icon loads or else this can get lost
    if (overlays.point && this.bearIcon) {
      const center = projectS2LatLng(S2LatLng.fromDegrees(overlays.point[0], overlays.point[1]));
      this.billboards.push({
        center,
        size: [32, 32],
        texture: this.bearIcon,
      });
    }

    this.lines.length = 0;
    if (overlays.polygon) {
      for (let l = 0; l < overlays.polygon.numLoops(); ++l) {
        const loop = overlays.polygon.loop(l);
        const {splits, vertices} = projectS2Loop(loop);
        let last = 0;
        for (const i of splits) {
          this.lines.push({
            colorFill: BOUNDARY_PALETTE.fill,
            colorStroke: BOUNDARY_PALETTE.stroke,
            stipple: false,
            vertices,
            verticesOffset: last,
            verticesLength: i - last,
          });
          last = i;
        }
      }
    }

    this.lastChange = Date.now();
  }

  hasDataNewerThan(time: number): boolean {
    return this.lastChange > time;
  }

  plan(viewportSize: Vec2, zoom: number, baker: RenderBaker): void {
    for (const billboard of this.billboards) {
      baker.addBillboard(
          billboard.center, NO_OFFSET, billboard.size, billboard.texture, /* z= */ 20);
    }
    baker.addLines(this.lines, BOUNDARY_RADIUS_PX, 0);
  }

  viewportBoundsChanged(viewportSize: Vec2, zoom: number): void {}
}

