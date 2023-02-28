import { rgbaToUint32 } from 'java/org/trailcatalog/client/common/math';
import { Vec2 } from 'java/org/trailcatalog/client/common/types';
import { TileData } from 'java/org/trailcatalog/client/map/tile_data';
import { TileDataService } from 'java/org/trailcatalog/client/map/tile_data_service';
import { S2CellId, S2Loop } from 'java/org/trailcatalog/s2';
import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';
import { Controller, Response } from 'js/corgi/controller';
import { CorgiEvent } from 'js/corgi/events';
import { HistoryService } from 'js/corgi/history/history_service';
import { Layer } from 'js/map/layer';
import { MapController } from 'js/map/map_controller';
import { projectS2Loop, unprojectS2LatLng } from 'js/map/models/camera';
import { RenderPlanner } from 'js/map/rendering/render_planner';

const CELL_BORDER = rgbaToUint32(1, 0, 0, 1);

export interface State {
  cells: string[];
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

  constructor(response: Response<ViewerController>) {
    super(response);
    this.layer = new CellLayer(this);
    this.mapController = response.deps.controllers.map;

    this.mapController.setLayers([
      this.layer,
      new TileData(this.mapController.camera, response.deps.services.tileData, this.mapController.renderer),
    ]);
  }

  changed(): void {
    this.updateState({
      cells: [...this.layer.cells.keys()],
    });
  }
}

class CellLayer extends Layer {

  readonly cells: Map<string, S2Loop>;
  private lastChange: number;

  constructor(private readonly controller: ViewerController) {
    super();
    this.cells = new Map<string, S2Loop>();
    this.lastChange = Date.now();
  }

  click(point: Vec2, px: [number, number], source: MapController): boolean {
    const zoom = source.camera.zoom;
    const cell = S2CellId.fromLatLng(unprojectS2LatLng(point[0], point[1])).parentAtLevel(zoom);
    const token = cell.toToken();
    if (this.cells.has(token)) {
      this.cells.delete(token);
    } else {
      this.cells.set(token, cell.toLoop(zoom));
    }
    this.controller.changed();
    this.lastChange = Date.now();
    return true;
  }

  hasDataNewerThan(time: number): boolean {
    return this.lastChange > time;
  }

  plan(size: Vec2, zoom: number, planner: RenderPlanner): void {
    const lines = [];
    for (const loop of this.cells.values()) {
      lines.push({
        colorFill: CELL_BORDER,
        colorStroke: CELL_BORDER,
        stipple: false,
        vertices: projectS2Loop(loop),
      });
    }

    planner.addLines(lines, 1, 0);
  }
}
