import { checkExists } from 'js/common/asserts';
import { Debouncer } from 'js/common/debouncer';
import { Controller, Response } from 'js/corgi/controller';
import { ViewsService } from 'js/corgi/history/views_service';
import { InputController } from 'js/emu/input_controller';
import { currentUrl } from 'js/server/ssr_aware';

import { latLngFromBase64E7, latLngRectFromBase64E7 } from './common/data';
import { BoundarySearchResult, TrailSearchResult } from './models/types';

import { DataResponses, fetchData } from './data';
import * as routes from './routes';

type Deps = typeof SearchController.deps;

export interface State {
  boundaries: BoundarySearchResult[];
  displayedQuery: string;
  query: string;
  trails: TrailSearchResult[],
}

export class SearchController extends Controller<{}, Deps, HTMLElement, State> {

  static deps() {
    return {
      controllers: {
        input: InputController,
      },
      services: {
        views: ViewsService<routes.Routes>,
      },
    };
  }

  private readonly debouncer: Debouncer;
  private readonly input: InputController;
  private readonly views: ViewsService<routes.Routes>;

  constructor(response: Response<SearchController>) {
    super(response);
    this.input = response.deps.controllers.input;
    this.views = response.deps.services.views;

    this.debouncer = new Debouncer(200 /* ms */, () => {
      this.actuallySearch();
    });
  }

  search(): void {
    this.goToSearchPage(this.input.value);
  }

  deferSearch(): void {
    this.debouncer.trigger();
  }

  private async actuallySearch(): Promise<void> {
    const query = this.input.value;
    const bp = fetchData('search_boundaries', {query});
    const tp = fetchData('search_trails', {query, limit: 100});
    const boundaries = await bp;
    const trails = await tp;

    if (query !== this.input.value) {
      return;
    }

    this.updateState({
      ...this.state,
      boundaries: searchBoundariesFromRaw(boundaries),
      query,
      trails: searchTrailsFromRaw(trails),
    });
  }

  private clearSearch(): void {
    if (this.state.displayedQuery) {
      const url = currentUrl();
      let camera;
      if (url.searchParams.has('lat')
          || url.searchParams.has('lng')
          || url.searchParams.has('zoom')) {
        camera = {
          lat: Number(url.searchParams.get('lat')),
          lng: Number(url.searchParams.get('lng')),
          zoom: Number(url.searchParams.get('zoom')),
        };
      }
      routes.showOverview({camera}, this.views);
    } else {
      this.updateState({
        ...this.state,
        query: '',
      });
    }
  }

  private goToSearchPage(query: string): void {
    routes.showSearchResults({query}, this.views);
  }
}

function searchBoundariesFromRaw(raw: DataResponses['search_boundaries']): BoundarySearchResult[] {
  return raw.results.map(
      b =>
          new BoundarySearchResult(
              BigInt(b.id),
              b.name,
              b.type,
              b.boundaries.map(id => ({id, ...raw.boundaries[id]})),
          ));
}

export function searchTrailsFromRaw(raw: DataResponses['search_trails']): TrailSearchResult[] {
  return raw.results.map(
      t =>
          new TrailSearchResult(
              BigInt(t.id),
              t.name,
              latLngRectFromBase64E7(t.bound),
              latLngFromBase64E7(t.marker),
              t.elevation_down_meters,
              t.elevation_up_meters,
              t.length_meters,
              t.boundaries.map(id => ({id, ...raw.boundaries[id]})),
          ));
}

