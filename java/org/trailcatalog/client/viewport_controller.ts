import { Controller, Response } from 'js/corgi/controller';
import { CorgiEvent } from 'js/corgi/events';
import { HistoryService } from 'js/corgi/history/history_service';
import { ViewsService } from 'js/corgi/history/views_service';
import { rgbaToUint32 } from 'js/map/common/math';
import { emptyLatLngRect, emptyPixelRect, LatLng, Vec2 } from 'js/map/common/types';
import { MbtileData } from 'js/map/layers/mbtile_data';
import { Style, TileData } from 'js/map/layers/tile_data';
import { TileDataService } from 'js/map/layers/tile_data_service';
import { MAPTILER_HILLSHADES, MAPTILER_PLANET, TRAILCATALOG_CONTOURS, TRAILCATALOG_HILLSHADES } from 'js/map/layers/tile_sources';
import { MapController } from 'js/map/map_controller';

import { MapDataService } from './data/map_data_service';
import { ACTIVE_PALETTE, ERROR_PALETTE, LinePalette } from './map/colors';
import { SELECTION_CHANGED } from './map/events';
import { Filters, MapData } from './map/map_data';
import { OverlayData, Overlays } from './map/overlay_data';
import { Path, Point, Trail } from './models/types';

import * as routes from './routes';

export interface Args {
  active?: {
    trails?: Trail[];
  };
  filters?: Filters;
  overlays?: Overlays;
}

export interface State {
  selected: Array<Path|Point|Trail>;
  selectedCardPosition: Vec2;
}

type Deps = typeof ViewportController.deps;

export class ViewportController<A extends Args, D extends Deps, S extends State>
    extends Controller<A, D, HTMLDivElement, S> {

  static deps() {
    return {
      controllers: {
        map: MapController,
      },
      services: {
        history: HistoryService,
        mapData: MapDataService,
        tileData: TileDataService,
        views: ViewsService<routes.Routes>,
      },
    };
  }

  private readonly history: HistoryService;
  private readonly mapData: MapData;
  private readonly overlayData: OverlayData;
  protected readonly mapController: MapController;
  protected readonly views: ViewsService<routes.Routes>;

  constructor(response: Response<ViewportController<A, D, S>>) {
    super(response);
    this.history = response.deps.services.history;
    this.mapController = response.deps.controllers.map;
    this.views = response.deps.services.views;

    this.mapData =
        new MapData(
            this.mapController.camera,
            response.deps.services.mapData,
            response.args.filters ?? {},
            this.mapController.renderer,
            this.mapController.textRenderer);
    this.overlayData = new OverlayData(response.args.overlays ?? {}, this.mapController.renderer);

    this.mapController.setLayers([
      new MbtileData(
          this.mapController.camera,
          response.deps.services.tileData,
          this.mapController.renderer,
          this.mapController.renderPlanner.baker,
          MAPTILER_PLANET),
      new MbtileData(
          this.mapController.camera,
          response.deps.services.tileData,
          this.mapController.renderer,
          this.mapController.renderPlanner.baker,
          TRAILCATALOG_CONTOURS),
      new TileData(
          this.mapController.camera,
          response.deps.services.tileData,
          this.mapController.renderer,
          Style.Rgb,
          rgbaToUint32(1, 1, 1, 0.3),
          1,
          TRAILCATALOG_HILLSHADES),
      this.mapData,
      this.overlayData,
    ]);

    (response.args.active?.trails ?? [])
        .forEach(t => this.setActive(t, true, t.lengthMeters >= 0 ? ACTIVE_PALETTE : ERROR_PALETTE));
  }

  goBack(): void {
    if (this.history.backStaysInApp()) {
      this.history.back();
    } else {
      routes.showOverview({camera: this.mapController.cameraLlz}, this.views);
    }
  }

  selectionChanged(e: CorgiEvent<typeof SELECTION_CHANGED>): void {
    const {clickPx, selected} = e.detail;

    let items: Array<Path|Point|Trail>;
    if (selected instanceof Path) {
      const trails = this.listTrailsOnPath(selected);
      if (trails.length === 0) {
        items = [selected];
      } else {
        items = trails;
      }
    } else if (!!selected) {
      items = [selected];
    } else {
      items = [];
    }

    this.updateState({
      ...this.state,
      selected: items,
      selectedCardPosition: clickPx,
    });
  }

  getTrail(id: bigint): Trail|undefined {
    return this.mapData.getTrail(id);
  }

  listTrailsInViewport(): Trail[] {
    return this.mapData.queryInBounds(this.mapController.viewportBounds).filter(isTrail);
  }

  listTrailsOnPath(path: Path): Trail[] {
    return this.mapData.listTrailsOnPath(path);
  }

  setActive(trail: Trail, state: boolean, color: LinePalette): void {
    return this.mapData.setActive(trail, state, color);
  }

  setHover(trail: Trail, state: boolean): void {
    return this.mapData.setHover(trail, state);
  }

  updateArgs(newArgs: Args): void {
    this.mapData.setFilters(newArgs.filters ?? {});
    this.overlayData.setOverlay(newArgs.overlays ?? {});
  }

  highlightTrail(e: MouseEvent): void {}
  unhighlightTrail(e: MouseEvent): void {}
}

function isTrail(e: Path|Point|Trail): e is Trail {
  return e instanceof Trail;
}
