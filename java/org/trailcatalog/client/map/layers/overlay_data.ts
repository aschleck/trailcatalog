import { S2Polygon } from 'java/org/trailcatalog/s2';
import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';

import { Vec2 } from '../../common/types';
import { BOUNDARY_PALETTE } from '../common/colors';
import { projectS2LatLng } from '../models/camera';
import { Line } from '../rendering/geometry';
import { RenderPlanner } from '../rendering/render_planner';

import { Layer } from './layer';

const BOUNDARY_RADIUS_PX = 1;

export class OverlayData extends Layer {

  private readonly lines: Line[];

  constructor(
      overlay: {
        polygon?: S2Polygon;
      },
  ) {
    super();
    this.lines = [];

    if (overlay.polygon) {
      for (let l = 0; l < overlay.polygon.numLoops(); ++l) {
        const loop = overlay.polygon.loop(l);
        const vertexCount = loop.numVertices();
        const vertices = new Float32Array(loop.numVertices() * 2 + 2);
        for (let v = 0; v < vertexCount; ++v) {
          const projected = projectS2LatLng(SimpleS2.pointToLatLng(loop.vertex(v)));
          vertices[v * 2 + 0] = projected[0];
          vertices[v * 2 + 1] = projected[1];
        }
        const projected = projectS2LatLng(SimpleS2.pointToLatLng(loop.vertex(0)));
        vertices[vertexCount * 2 + 0] = projected[0];
        vertices[vertexCount * 2 + 1] = projected[1];

        this.lines.push({
          colorFill: BOUNDARY_PALETTE.fill,
          colorStroke: BOUNDARY_PALETTE.stroke,
          vertices,
        });
      }
    }
  }

  hasDataNewerThan(time: number): boolean {
    return false;
  }

  plan(viewportSize: Vec2, zoom: number, planner: RenderPlanner): void {
    planner.addLines(this.lines, BOUNDARY_RADIUS_PX, 0);
  }

  viewportBoundsChanged(viewportSize: Vec2, zoom: number): void {}
}

