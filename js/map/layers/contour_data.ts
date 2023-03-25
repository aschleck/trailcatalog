import { HashMap } from 'js/common/collections';
import { debugMode } from 'js/common/debug';
import { LittleEndianView } from 'js/common/little_endian_view';

import { rgbaToUint32 } from '../common/math';
import { TileId, Vec2, VectorTileset } from '../common/types';
import { Layer } from '../layer';
import { Camera, projectE7Array } from '../models/camera';
import { RenderPlanner } from '../rendering/render_planner';
import { Renderer } from '../rendering/renderer';

import { TileDataService } from './tile_data_service';

const CONTOURS: VectorTileset = {
  extraZoom: 0,
  minZoom: 10,
  maxZoom: 10,
  tileUrl:
      debugMode()
          ? '/tiles/contours/mercator/${id.zoom}/${id.x}/${id.y}_m.cbf'
          : 'https://tiles.trailcatalog.org/contours/${id.zoom}/${id.x}/${id.y}_ft.cbf',
  type: 'vector',
} as const;
const NO_OFFSET: Vec2 = [0, 0];

const FILL = rgbaToUint32(0.7, 0.7, 0.7, 1);
const STROKE = rgbaToUint32(0, 0, 0, 0);

interface Contour {
  altitude: number;
  vertices: Float64Array;
}

export class ContourData extends Layer {

  private lastChange: number;
  private readonly tiles: HashMap<TileId, Contour[]>;

  constructor(
      private readonly camera: Camera,
      private readonly dataService: TileDataService,
      private readonly renderer: Renderer) {
    super();
    this.lastChange = Date.now();
    this.tiles = new HashMap(id => `${id.x},${id.y},${id.zoom}`);

    this.registerDisposable(this.dataService.streamVectors(CONTOURS, this));
  }

  hasDataNewerThan(time: number): boolean {
    return this.lastChange > time;
  }

  plan(viewportSize: Vec2, zoom: number, planner: RenderPlanner): void {
    let significance;
    if (zoom > 14) {
      significance = 40;
    } else if (zoom > 10) {
      significance = 100;
    } else {
      significance  = 150;
    }

    const sorted = [...this.tiles].sort((a, b) => a[0].zoom - b[0].zoom);
    const lines = [];
    for (const [id, contours] of sorted) {
      for (const contour of contours) {
        if (contour.altitude % significance !== 0) {
          continue;
        }

        lines.push({
          colorFill: FILL,
          colorStroke: STROKE,
          stipple: false,
          vertices: contour.vertices,
        });
      }
    }

    planner.addLines(lines, 1, 20);
  }

  viewportBoundsChanged(viewportSize: Vec2, zoom: number): void {
    // TODO: we don't need to do this because another layer already does it, shady!
    // We could debounce it but that feels odd...
    // this.dataService.updateViewport(this.camera.centerPixel, viewportSize, zoom);
  }

  loadTile(id: TileId, buffer: ArrayBuffer): void {
    this.lastChange = Date.now();

    const data = new LittleEndianView(buffer);
    const contourCount = data.getVarInt32();
    const contours = [];
    for (let i = 0; i < contourCount; ++i) {
      contours.push({
        altitude: data.getVarInt32(),
        vertices: projectE7Array(new Int32Array(data.slice(2 * 4 * data.getVarInt32()))),
      });
    }
    this.tiles.set(id, contours);
  }

  unloadTiles(ids: TileId[]): void {
    for (const id of ids) {
      this.tiles.delete(id);
    }
    this.lastChange = Date.now();
  }
}

