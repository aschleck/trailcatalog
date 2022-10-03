import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';
import { checkExists } from 'js/common/asserts';
import { Controller, Response } from 'js/corgi/controller';
import { CorgiEvent } from 'js/corgi/events';

import { emptyLatLngRect, emptyPixelRect, emptyS2Polygon, LatLng } from './common/types';
import { Boundary, Trail, TrailSearchResult } from './models/types';
import { ViewsService } from './views/views_service';

import { decodeBase64 } from './base64';
import { boundaryFromRaw, trailsInBoundaryFromRaw } from './boundary_overview_controller';
import { DataResponses, fetchData } from './data';
import { searchTrailsFromRaw } from './search_controller';
import { Deps, State as VState, ViewportController } from './viewport_controller';

interface Args {
  boundaryId: string|undefined;
  query: string;
}

export interface State extends VState {
  boundary: Boundary|undefined;
  filterInBoundary: boolean;
  trailsInBoundary: Set<bigint>|undefined;
  searchTrails: TrailSearchResult[]|undefined;
  searchTrailsIds: Set<bigint>|undefined;
}

export class SearchResultsOverviewController extends ViewportController<Args, Deps, State> {

  static deps() {
    return {
      services: {
        views: ViewsService,
      },
    };
  }

  private query: string;

  constructor(response: Response<SearchResultsOverviewController>) {
    super(response);
    this.query = response.args.query;

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
          this.updateState({
            ...this.state,
            trailsInBoundary: new Set(trailsInBoundaryFromRaw(raw).map(t => t.id)),
          });
        });
      }
    }

    fetchData('search_trails', {query: this.query}).then(raw => {
      const searchTrails = searchTrailsFromRaw(raw);
      this.updateState({
        ...this.state,
        searchTrails,
        searchTrailsIds: new Set(searchTrails.map(t => t.id)),
      });
    });
  }

  clearBoundary(): void {
    this.views.showSearchResults({
      camera: this.lastCamera,
      query: this.query,
    });
  }

  toggleBoundaryFilter(): void {
    this.updateState({
      ...this.state,
      filterInBoundary: !this.state.filterInBoundary,
    });
  }
}

