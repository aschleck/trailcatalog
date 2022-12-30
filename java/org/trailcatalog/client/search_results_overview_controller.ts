import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';
import { checkExists } from 'js/common/asserts';
import { Controller, Response } from 'js/corgi/controller';
import { CorgiEvent } from 'js/corgi/events';

import { decodeBase64 } from './common/base64';
import { emptyLatLngRect, emptyPixelRect, emptyS2Polygon, LatLng, s2LatLngRectToTc } from './common/types';
import { DATA_CHANGED, HOVER_CHANGED, MapController, MAP_MOVED, SELECTION_CHANGED } from './map/events';
import { Boundary, Path, Trail, TrailSearchResult } from './models/types';
import { ViewsService } from './views/views_service';

import { boundaryFromRaw, trailsInBoundaryFromRaw } from './boundary_overview_controller';
import { DataResponses, fetchData } from './data';
import { searchTrailsFromRaw } from './search_controller';
import { State as VState, ViewportController } from './viewport_controller';

interface Args {
  boundaryId: string|undefined;
  query: string|undefined;
}

type Deps = typeof SearchResultsOverviewController.deps;

export interface State extends VState {
  boundary: Boundary|undefined;
  clickCandidate?: {
    lastClick: number;
    trail: Trail;
  };
  filterInBoundary: boolean;
  hovering: Path|Trail|undefined;
  nearbyTrails: Trail[]|undefined;
  trailsFilter: (id: bigint) => boolean;
  trailsInBoundary: Trail[]|undefined;
  trailsInBoundaryFilter: (id: bigint) => boolean;
  trailsInBoundaryIds: Set<bigint>|undefined;
  searchTrails: TrailSearchResult[]|undefined;
  searchTrailsIds: Set<bigint>|undefined;
}

const DOUBLE_CLICK_DETECTION_MS = 250;
export const LIMIT = 100;

export class SearchResultsOverviewController extends ViewportController<Args, Deps, State> {

  static deps() {
    return {
      services: {
        views: ViewsService,
      },
    };
  }

  protected readonly views: ViewsService;
  private query: string|undefined;
  protected lastCamera: {lat: number; lng: number; zoom: number}|undefined;
  protected mapController: MapController|undefined;

  constructor(response: Response<SearchResultsOverviewController>) {
    super(response);
    this.views = response.deps.services.views;
    this.query = response.args.query;

    // We do this here to
    // a) avoid making filter functions every time the TSX re-renders
    // b) capture this controller's this reference, because the state reference isn't stable
    this.updateState({
      ...this.state,
      trailsFilter: (id: bigint) => {
        const searchTrailsIds = this.state.searchTrailsIds;
        if (searchTrailsIds && !searchTrailsIds.has(id)) {
          return false;
        }

        return true;
      },
      trailsInBoundaryFilter: (id: bigint) => {
        const searchTrailsIds = this.state.searchTrailsIds;
        if (searchTrailsIds && !searchTrailsIds.has(id)) {
          return false;
        }

        const trailsInBoundaryIds = this.state.trailsInBoundaryIds;
        if (trailsInBoundaryIds) {
          return trailsInBoundaryIds.has(id);
        }

        return true;
      },
    });

    if (response.args.boundaryId) {
      const id = response.args.boundaryId;
      if (!this.state.boundary) {
        fetchData('boundary', {id}).then(raw => {
          this.updateState({
            ...this.state,
            boundary: boundaryFromRaw(raw),
            filterInBoundary: true,
          });
        });
      }

      if (!this.state.trailsInBoundary) {
        fetchData('trails_in_boundary', {boundary_id: id}).then(raw => {
          const trailsInBoundary = trailsInBoundaryFromRaw(raw);
          this.updateState({
            ...this.state,
            trailsInBoundary,
            trailsInBoundaryIds: new Set(trailsInBoundary.map(t => t.id)),
          });
        });
      }
    }

    if (this.query && !this.state.searchTrails) {
      fetchData('search_trails', {query: this.query, limit: LIMIT}).then(raw => {
        const searchTrails = searchTrailsFromRaw(raw);
        this.updateState({
          ...this.state,
          searchTrails,
          searchTrailsIds: new Set(searchTrails.map(t => t.id)),
        });
      });
    }
  }

  centerBoundary(): void {
    if (this.state.boundary) {
      const bound = this.state.boundary.polygon.getRectBound();
      this.mapController?.setCamera(s2LatLngRectToTc(bound));
    }
  }

  clearBoundary(): void {
    if (this.query) {
      this.views.showSearchResults({
        camera: this.lastCamera,
        query: this.query,
      });
    } else {
      this.views.showOverview(this.lastCamera);
    }
  }

  locateMe(): void {
    navigator.geolocation.getCurrentPosition(position => {
      this.mapController?.setCamera({
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        zoom: 12,
      });
    }, e => {
      console.error(e);
    });
  }

  toggleBoundaryFilter(): void {
    this.updateState({
      ...this.state,
      filterInBoundary: !this.state.filterInBoundary,
    });
  }

  onDataChange(e: CorgiEvent<typeof DATA_CHANGED>): void {
    const {controller} = e.detail;
    this.mapController = controller;
    this.updateState({
      ...this.state,
      nearbyTrails: controller.listTrailsInViewport()
          .sort((a, b) => b.lengthMeters - a.lengthMeters),
    });
  }

  onHoverChanged(e: CorgiEvent<typeof HOVER_CHANGED>): void {
    const {controller} = e.detail;
    this.mapController = controller;
    this.updateState({
      ...this.state,
      hovering: e.detail.target,
    });
  }

  onMove(e: CorgiEvent<typeof MAP_MOVED>): void {
    const {controller, center, zoom} = e.detail;
    this.mapController = controller;
    this.lastCamera = {
      lat: center.latDegrees(),
      lng: center.lngDegrees(),
      zoom,
    };
    this.updateState({
      ...this.state,
      nearbyTrails: controller.listTrailsInViewport()
          .sort((a, b) => b.lengthMeters - a.lengthMeters),
    });
  }

  override selectionChanged(e: CorgiEvent<typeof SELECTION_CHANGED>): void {
    this.mapController = e.detail.controller;

    super.selectionChanged(e);

    const trails = this.state.selectedTrails;
    let clickCandidate;
    if (trails.length === 0) {
      // Hack to handle the reality of MapController's pointerdown handler clearing selection prior
      // to pointerup. See note there.
      clickCandidate = this.state.clickCandidate;
    } else if (trails.length === 1) {
      const candidate = trails[0];
      const now = Date.now();
      if (this.state.clickCandidate?.trail === candidate
          && now - this.state.clickCandidate.lastClick < DOUBLE_CLICK_DETECTION_MS) {
       this.views.showTrail(candidate.id);
       return;
      }

      clickCandidate = {
        lastClick: now,
        trail: candidate,
      };
    }

    this.updateState({
      ...this.state,
      clickCandidate,
    });
  }

  viewTrail(e: MouseEvent): void {
    const raw = (e.currentTarget as HTMLElement|undefined)?.dataset?.trailId;
    if (raw === undefined) {
      console.error('Unable to find trail ID');
      return;
    }

    const id = BigInt(raw);
    this.views.showTrail(id);
  }

  override highlightTrail(e: MouseEvent): void {
    this.setTrailHighlighted(e, true);
  }

  override unhighlightTrail(e: MouseEvent): void {
    this.setTrailHighlighted(e, false);
  }

  private setTrailHighlighted(e: MouseEvent, selected: boolean): void {
    if (!this.mapController) {
      return;
    }
    const id = (checkExists(e.currentTarget) as HTMLElement).dataset.trailId;
    if (!id) {
      return;
    }
    const trail = this.mapController.getTrail(BigInt(id));
    if (!trail) {
      return;
    }
    this.mapController.setHover(trail, selected);
    this.updateState({
      ...this.state,
      hovering: selected ? trail : undefined,
    });
  }
}

