import { checkExists } from 'external/dev_april_corgi~/js/common/asserts';
import { Future } from 'external/dev_april_corgi~/js/common/futures';
import { Controller, Response } from 'external/dev_april_corgi~/js/corgi/controller';
import { CorgiEvent, DOM_MOUSE } from 'external/dev_april_corgi~/js/corgi/events';

import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';
import { LatLng } from 'js/map/common/types';
import { DATA_CHANGED, MAP_MOVED } from 'js/map/events';

import { decodeBase64 } from './common/base64';
import { emptyS2Polygon, s2LatLngRectToTc } from './common/types';
import { HOVER_CHANGED, SELECTION_CHANGED } from './map/events';
import { Boundary, Path, Point, Trail, TrailSearchResult } from './models/types';

import { boundaryFromRaw, trailsInBoundaryFromRaw } from './boundary_detail_controller';
import { DataResponses, fetchData } from './data';
import * as routes from './routes';
import { searchTrailsFromRaw } from './search_controller';
import { Args as VArgs, State as VState, ViewportController } from './viewport_controller';

interface Args extends VArgs {
  boundaryId: string|undefined;
  query: string|undefined;
}

type Deps = typeof SearchResultsOverviewController.deps;

export interface State extends VState {
  blueDot: LatLng|undefined;
  boundaryId: string|undefined;
  boundary: Future<Boundary>|undefined;
  clickCandidate?: {
    lastClick: number;
    trail: Trail;
  };
  filterInBoundary: boolean;
  hovering: Path|Point|Trail|undefined;
  mobileSidebarOpen: boolean;
  nearbyTrails: Trail[];
  trailsFilter: (id: bigint) => boolean;
  trailsInBoundary: Future<Trail[]>|undefined;
  trailsInBoundaryFilter: (id: bigint) => boolean;
  trailsInBoundaryIds: Future<Set<bigint>>|undefined;
  searchQuery?: string;
  searchTrails: Future<TrailSearchResult[]>|undefined;
  searchTrailsIds: Future<Set<bigint>>|undefined;
}

const DOUBLE_CLICK_DETECTION_MS = 250;
export const LIMIT = 100;

export class SearchResultsOverviewController extends ViewportController<Args, Deps, State> {

  static deps() {
    return ViewportController.deps();
  }

  private searchQuery: string|undefined;

  constructor(response: Response<SearchResultsOverviewController>) {
    super(response);
    this.searchQuery = response.args.query;

    // We do this here to
    // a) avoid making filter functions every time the TSX re-renders
    // b) capture this controller's this reference, because the state reference isn't stable
    this.updateState({
      ...this.state,
      trailsFilter: (id: bigint) => {
        const searchTrailsIds = this.state.searchTrailsIds;
        if (searchTrailsIds && !searchTrailsIds.value().has(id)) {
          return false;
        }

        return true;
      },
      trailsInBoundaryFilter: (id: bigint) => {
        const searchTrailsIds = this.state.searchTrailsIds;
        if (searchTrailsIds && !searchTrailsIds.value().has(id)) {
          return false;
        }

        const trailsInBoundaryIds = this.state.trailsInBoundaryIds;
        if (trailsInBoundaryIds) {
          return trailsInBoundaryIds.value().has(id);
        }

        return true;
      },
    });
  }

  centerBoundary(): void {
    if (this.state.boundary) {
      const bound = this.state.boundary.value().polygon.getRectBound();
      this.mapController.setCamera(s2LatLngRectToTc(bound));
    }
  }

  clearBoundary(): void {
    if (this.searchQuery) {
      routes.showSearchResults({
        camera: this.mapController.cameraLlz,
        query: this.searchQuery,
      }, this.views);
    } else {
      routes.showOverview({camera: this.mapController.cameraLlz}, this.views);
    }
  }

  locateMe(): void {
    const options = {enableHighAccuracy: true, maximumAge: 10_000};
    navigator.geolocation.getCurrentPosition(position => {
      const ll = [position.coords.latitude, position.coords.longitude] as const as LatLng;
      this.mapController.setCamera({
        lat: ll[0],
        lng: ll[1],
        zoom: 12,
      });

      this.updateState({
        ...this.state,
        blueDot: ll,
      });

      if (!this.state.blueDot) {
        navigator.geolocation.watchPosition(this.locationUpdated.bind(this), undefined, options);
      }
    }, e => {
      console.error(e);
    }, options);
  }

  private locationUpdated(position: GeolocationPosition) {
    this.updateState({
      ...this.state,
      blueDot: [position.coords.latitude, position.coords.longitude] as const as LatLng,
    });
  }

  toggleBoundaryFilter(): void {
    this.updateState({
      ...this.state,
      filterInBoundary: !this.state.filterInBoundary,
    });
  }

  onDataChange(e: CorgiEvent<typeof DATA_CHANGED>): void {
    this.updateState({
      ...this.state,
      nearbyTrails:
          this.listTrailsInViewport()
              .sort(
                  (a, b) =>
                      (b.lengthMeters >= 0 ? b.lengthMeters : Number.MAX_VALUE)
                          - (a.lengthMeters >= 0 ? a.lengthMeters : Number.MAX_VALUE)),
    });
  }

  onHoverChanged(e: CorgiEvent<typeof HOVER_CHANGED>): void {
    this.updateState({
      ...this.state,
      hovering: e.detail.target,
    });
  }

  onMove(e: CorgiEvent<typeof MAP_MOVED>): void {
    const {center, zoom} = e.detail;
    const url = new URL(window.location.href);
    url.searchParams.set('lat', center.latDegrees().toFixed(7));
    url.searchParams.set('lng', center.lngDegrees().toFixed(7));
    url.searchParams.set('zoom', zoom.toFixed(3));
    window.history.replaceState(null, '', url);

    this.updateState({
      ...this.state,
      nearbyTrails: this.listTrailsInViewport()
          .sort((a, b) => b.lengthMeters - a.lengthMeters),
    });
  }

  toggleSidebar(): void {
    this.updateState({
      ...this.state,
      mobileSidebarOpen: !this.state.mobileSidebarOpen,
    });
  }

  override selectionChanged(e: CorgiEvent<typeof SELECTION_CHANGED>): void {
    super.selectionChanged(e);

    const trails = this.state.selected;
    let clickCandidate;
    if (trails.length === 0) {
      // Hack to handle the reality of MapController's pointerdown handler clearing selection prior
      // to pointerup. See note there.
      clickCandidate = this.state.clickCandidate;
    } else if (trails.length === 1 && trails[0] instanceof Trail) {
      const candidate = trails[0];
      const now = Date.now();
      if (this.state.clickCandidate?.trail === candidate
          && now - this.state.clickCandidate.lastClick < DOUBLE_CLICK_DETECTION_MS) {
        routes.showTrail(candidate.id, this.views);
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

  viewTrail(e: CorgiEvent<typeof DOM_MOUSE>): void {
    const raw = e.actionElement.data('trailId')?.string();
    if (raw === undefined) {
      console.error('Unable to find trail ID');
      return;
    }

    const id = BigInt(raw);
    routes.showTrail(id, this.views);
  }

  override highlightTrail(e: CorgiEvent<typeof DOM_MOUSE>): void {
    this.setTrailHighlighted(e, true);
  }

  override unhighlightTrail(e: CorgiEvent<typeof DOM_MOUSE>): void {
    this.setTrailHighlighted(e, false);
  }

  private setTrailHighlighted(e: CorgiEvent<typeof DOM_MOUSE>, selected: boolean): void {
    const id = e.actionElement.data('trailId')?.string();
    if (!id) {
      return;
    }
    const trail = this.getTrail(BigInt(id));
    if (!trail) {
      return;
    }
    this.setHover(trail, selected);
    this.updateState({
      ...this.state,
      hovering: selected ? trail : undefined,
    });
  }
}

