import { S2CellId, S2LatLng, S2Loop } from 'java/org/trailcatalog/s2';
import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';
import { Controller, Response } from 'js/corgi/controller';
import { CorgiEvent } from 'js/corgi/events';
import { HistoryService } from 'js/corgi/history/history_service';
import { CHANGED } from 'js/dino/events';
import { rgbaToUint32 } from 'js/map/common/math';
import { Vec2 } from 'js/map/common/types';
import { MAP_MOVED } from 'js/map/events';
import { Layer } from 'js/map/layer';
import { MbtileData } from 'js/map/layers/mbtile_data';
import { Style, TileData } from 'js/map/layers/tile_data';
import { TileDataService } from 'js/map/layers/tile_data_service';
import { MAPTILER_CONTOURS, MAPTILER_DEM, MAPTILER_OUTDOOR, MAPTILER_PLANET, MAPTILER_TOPO, TRAILCATALOG_CONTOURS } from 'js/map/layers/tile_sources';
import { MapController } from 'js/map/map_controller';
import { projectS2Loop, unprojectS2LatLng } from 'js/map/models/camera';
import { RenderPlanner } from 'js/map/rendering/render_planner';

const CELL_BORDER = rgbaToUint32(1, 0, 0, 1);
export const ZOOM_LEVEL = -1;

export interface State {
  cells: string[];
  level: number;
  selected?: {
    cell: S2CellId,
    clickPx: [number, number],
  };
}

type Deps = typeof ViewerController.deps;

export class ViewerController extends Controller<{}, Deps, HTMLElement, State> {

  static deps() {
    return {
      controllers: {
        map: MapController,
      },
      services: {
        tileData: TileDataService,
      },
    };
  }

  private readonly layer: CellLayer;
  private readonly mapController: MapController;
  lastChange: number;

  constructor(response: Response<ViewerController>) {
    super(response);
    this.layer = new CellLayer(this);
    this.mapController = response.deps.controllers.map;
    this.lastChange = Date.now();

    this.mapController.setLayers([
      this.layer,
      //new TileData(
      //    this.mapController.camera,
      //    response.deps.services.tileData,
      //    this.mapController.renderer,
      //    Style.Hypsometry,
      //    MAPTILER_DEM),
      new MbtileData(
          this.mapController.camera,
          response.deps.services.tileData,
          this.mapController.renderer,
          MAPTILER_PLANET),
      new MbtileData(
          this.mapController.camera,
          response.deps.services.tileData,
          this.mapController.renderer,
          TRAILCATALOG_CONTOURS),
    ]);
  }

  onMove(e: CorgiEvent<typeof MAP_MOVED>): void {
    const {center, zoom} = e.detail;
    const url = new URL(window.location.href);
    url.searchParams.set('lat', center.latDegrees().toFixed(7));
    url.searchParams.set('lng', center.lngDegrees().toFixed(7));
    url.searchParams.set('zoom', zoom.toFixed(3));
    window.history.replaceState(null, '', url);
  }

  setLevel(e: CorgiEvent<typeof CHANGED>): void {
    this.updateState({
      ...this.state,
      level: Number(e.detail.value),
    });
  }

  showCells(e: CorgiEvent<typeof CHANGED>): void {
    if (e.detail.value.trim().length === 0) {
      this.layer.cells.clear();
      this.layerUpdated();
    }

    const values = e.detail.value.split(',').map(t => t.trim());
    const cells = [];
    let valid = true;
    for (const value of values) {
      try {
        cells.push(S2CellId.fromToken(value));
      } catch (e) {
        valid = false;
        break;
      }
    }

    if (valid) {
      this.layer.cells.clear();
      for (const cell of cells) {
        this.layer.cells.set(cell.toToken(), cell.toLoop(cell.level()));
      }

      this.layerUpdated();
    }
  }

  selectCell(point: S2LatLng, px: [number, number]): void {
    const cell = S2CellId.fromLatLng(point);
    let level = cell.level();
    while (level >= 0 && !this.layer.cells.has(cell.parentAtLevel(level).toToken())) {
      level -= 1;
    }

    if (level >= 0) {
      this.updateState({
        ...this.state,
        selected: {
          cell: cell.parentAtLevel(level),
          clickPx: px,
        },
      });
    } else {
      this.updateState({
        ...this.state,
        selected: undefined,
      });
    }
  }

  toggleCell(point: S2LatLng, currentZoom: number): void {
    const level = this.state.level === ZOOM_LEVEL ? currentZoom : this.state.level;
    const cell = S2CellId.fromLatLng(point).parentAtLevel(level);
    const token = cell.toToken();
    if (this.layer.cells.has(token)) {
      this.layer.cells.delete(token);
    } else {
      this.layer.cells.set(token, cell.toLoop(cell.level()));
    }

    this.layerUpdated();
  }

  private layerUpdated() {
    this.updateState({
      ...this.state,
      cells: [...this.layer.cells.keys()],
      selected: undefined,
    });
    this.lastChange = Date.now();
  }
}

class CellLayer extends Layer {

  readonly cells: Map<string, S2Loop>;

  constructor(private readonly controller: ViewerController) {
    super();
    this.cells = new Map<string, S2Loop>();
  }

  click(point: Vec2, px: [number, number], contextual: boolean, source: MapController): boolean {
    if (contextual) {
      this.controller.selectCell(unprojectS2LatLng(point[0], point[1]), px);
    } else {
      this.controller.toggleCell(unprojectS2LatLng(point[0], point[1]), source.camera.zoom);
    }
    return true;
  }

  hasDataNewerThan(time: number): boolean {
    return this.controller.lastChange > time;
  }

  plan(size: Vec2, zoom: number, planner: RenderPlanner): void {
    const lines = [];
    for (const loop of this.cells.values()) {
      const {splits, vertices} = projectS2Loop(loop);
      let last = 0;
      for (const i of splits) {
        lines.push({
          colorFill: CELL_BORDER,
          colorStroke: CELL_BORDER,
          stipple: false,
          vertices: vertices,
          verticesOffset: last,
          verticesLength: i - last,
        });
        last = i;
      }
    }

    planner.addLines(lines, 1, 0);
  }
}
