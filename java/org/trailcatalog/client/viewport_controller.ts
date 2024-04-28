import { Controller, Response } from 'js/corgi/controller';
import { CorgiEvent } from 'js/corgi/events';
import { HistoryService } from 'js/corgi/history/history_service';
import { ViewsService } from 'js/corgi/history/views_service';
import { emptyPixelRect } from 'js/map/common/types';
import { rgbaToUint32 } from 'js/map2/common/math';
import { RgbaU32, Vec2 } from 'js/map2/common/types';
import { Layer } from 'js/map2/layer';
import { MbtileLayer, CONTOURS_FEET, CONTOURS_METERS, NATURE } from 'js/map2/layers/mbtile_layer';
import { RasterTileLayer } from 'js/map2/layers/raster_tile_layer';
import { MapController } from 'js/map2/map_controller';
import { Z_BASE_TERRAIN } from 'js/map2/z';
import { UnitSystem } from 'js/server/ssr_aware';

import { MapDataService } from './data/map_data_service';
import { ACTIVE_PALETTE, ERROR_PALETTE, LinePalette } from './map/colors';
import { SELECTION_CHANGED } from './map/events';
import { OverlayLayer, Overlays } from './map/overlay_layer';
import { Filters, TrailLayer } from './map/trail_layer';
import { Path, Point, Trail } from './models/types';

import * as routes from './routes';

export interface Args {
  active?: {
    trails?: Trail[];
  };
  filters?: Filters;
  overlays?: Overlays;
  units: UnitSystem;
}

export interface LayerState {
  name: string;
  enabled: boolean;
  layer: Layer;
}

export interface State {
  layers: LayerState[];
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
        views: ViewsService<routes.Routes>,
      },
    };
  }

  private readonly history: HistoryService;
  private readonly mapData: TrailLayer;
  private readonly overlayData: OverlayLayer;
  protected readonly mapController: MapController;
  protected readonly views: ViewsService<routes.Routes>;

  constructor(response: Response<ViewportController<A, D, S>>) {
    super(response);
    this.history = response.deps.services.history;
    this.mapController = response.deps.controllers.map;
    this.views = response.deps.services.views;

    this.mapData =
        new TrailLayer(
            this.mapController.camera,
            response.deps.services.mapData,
            response.args.filters ?? {},
            this.mapController.renderer);
    this.overlayData =
        new OverlayLayer(
            response.args.overlays ?? {},
            this.mapController.renderer);

    const allLayers = [{
      name: 'Hillshades',
      enabled: true,
      layer: new RasterTileLayer(
          [{
            long: 'Contains modified Copernicus Sentinel data 2021',
            short: 'Copernicus 2021',
          }, {
            long: 'Contains modified NASADEM data 2000',
          }],
          'https://tiles.trailcatalog.org/hillshades/${id.zoom}/${id.x}/${id.y}.webp',
          /* tint= */ 0xFFFFFF88 as RgbaU32,
          /* z= */ Z_BASE_TERRAIN,
          /* extraZoom= */ 0,
          /* minZoom= */ 0,
          /* maxZoom= */ 12,
          this.mapController.renderer,
      ),
    }, {
      name: 'Contours (imperial)',
      enabled: response.args.units === 'imperial',
      layer: new MbtileLayer(
          [{
            long: 'Contains modified Copernicus Sentinel data 2021',
            short: 'Copernicus 2021',
          }, {
            long: 'Contains modified NASADEM data 2000',
          }],
          'https://tiles.trailcatalog.org/contours/${id.zoom}/${id.x}/${id.y}.pbf',
          CONTOURS_FEET,
          /* extraZoom= */ 0,
          /* minZoom= */ 9,
          /* maxZoom= */ 14,
          this.mapController.renderer,
      ),
    }, {
      name: 'Contours (metric)',
      enabled: response.args.units === 'metric',
      layer: new MbtileLayer(
          [{
            long: 'Contains modified Copernicus Sentinel data 2021',
            short: 'Copernicus 2021',
          }, {
            long: 'Contains modified NASADEM data 2000',
          }],
          'https://tiles.trailcatalog.org/contours/${id.zoom}/${id.x}/${id.y}.pbf',
          CONTOURS_METERS,
          /* extraZoom= */ 0,
          /* minZoom= */ 9,
          /* maxZoom= */ 14,
          this.mapController.renderer,
      ),
    }, {
      name: 'MapTiler vector',
      enabled: true,
      layer: new MbtileLayer(
          [
            {
              long: 'Base political and transportation packaged and served by MapTiler',
              short: 'MapTiler',
              url: 'https://www.maptiler.com/copyright/',
            },
            {
              long: 'Base political and transportation data provided by the OpenStreetMap project',
              short: 'OpenStreetMap contributors',
              url: 'https://www.openstreetmap.org/copyright',
            },
          ],
          'https://api.maptiler.com/tiles/v3/${id.zoom}/${id.x}/${id.y}.pbf?'
              + 'key=wWxlJy7a8SEPXS7AZ42l',
          NATURE,
          /* extraZoom= */ 0,
          /* minZoom= */ 0,
          /* maxZoom= */ 15,
          this.mapController.renderer,
      ),
    }, {
      name: 'Trails',
      enabled: true,
      layer: this.mapData,
    }, {
      name: 'Overlay',
      enabled: true,
      layer: this.overlayData,
    }];
    for (const layer of allLayers) {
      this.registerDisposable(layer.layer);
    }
    this.updateState({
      ...this.state,
      layers: allLayers,
    });
    this.mapController.setLayers(allLayers.filter(l => l.enabled).map(l => l.layer));

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

    const newLayers = [];
    for (const layer of this.state.layers) {
      if (layer.name === `Contours (${newArgs.units})`) {
        newLayers.push({
          ...layer,
          enabled: true,
        });
      } else if (layer.name.startsWith('Contours ')) {
        newLayers.push({
          ...layer,
          enabled: false,
        });
      } else {
        newLayers.push(layer);
      }
    }

    this.updateState({
      ...this.state,
      layers: newLayers,
    });
    this.mapController.setLayers(newLayers.filter(l => l.enabled).map(l => l.layer));
  }

  highlightTrail(e: MouseEvent): void {}
  unhighlightTrail(e: MouseEvent): void {}
}

function isTrail(e: Path|Point|Trail): e is Trail {
  return e instanceof Trail;
}
