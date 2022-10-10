import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';
import { checkExists } from 'js/common/asserts';
import { Controller, Response } from 'js/corgi/controller';
import { CorgiEvent } from 'js/corgi/events';

import { decodeBase64 } from './common/base64';
import { emptyLatLngRect, emptyPixelRect, emptyS2Polygon, LatLng, s2LatLngRectToTc } from './common/types';
import { Boundary, Trail, TrailSearchResult } from './models/types';
import { ViewsService } from './views/views_service';

import { boundaryFromRaw, trailsInBoundaryFromRaw } from './boundary_overview_controller';
import { DataResponses, fetchData } from './data';
import { searchTrailsFromRaw } from './search_controller';
import { Deps, State as VState, ViewportController } from './viewport_controller';

interface Args {
  boundaryId: string|undefined;
  query: string|undefined;
}

export interface State extends VState {
  boundary: Boundary|undefined;
  filterInBoundary: boolean;
  trailsFilter: (id: bigint) => boolean;
  trailsInBoundary: Trail[]|undefined;
  trailsInBoundaryFilter: (id: bigint) => boolean;
  trailsInBoundaryIds: Set<bigint>|undefined;
  searchTrails: TrailSearchResult[]|undefined;
  searchTrailsIds: Set<bigint>|undefined;
}

export const LIMIT = 100;

export class SearchResultsOverviewController extends ViewportController<Args, Deps, State> {

  static deps() {
    return {
      services: {
        views: ViewsService,
      },
    };
  }

  private query: string|undefined;

  constructor(response: Response<SearchResultsOverviewController>) {
    super(response);
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

  toggleBoundaryFilter(): void {
    this.updateState({
      ...this.state,
      filterInBoundary: !this.state.filterInBoundary,
    });
  }
}

