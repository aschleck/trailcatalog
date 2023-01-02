import { checkExists } from 'js/common/asserts';
import { Debouncer } from 'js/common/debouncer';
import { Controller, Response } from 'js/corgi/controller';

import { latLngFromBase64E7 } from './common/data';
import { currentUrl } from './common/ssr_aware';
import { BoundarySearchResult, TrailSearchResult } from './models/types';
import { ViewsService } from './views/views_service';

import { DataResponses, fetchData } from './data';

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
      services: {
        views: ViewsService,
      },
    };
  }

  private readonly debouncer: Debouncer;
  private readonly views: ViewsService;

  constructor(response: Response<SearchController>) {
    super(response);
    this.views = response.deps.services.views;

    this.debouncer = new Debouncer(200 /* ms */, () => {
      this.actuallySearch();
    });
  }

  search(e: KeyboardEvent): void {
    const input = checkExists(e.srcElement) as HTMLInputElement;
    this.updateState({
      ...this.state,
      query: input.value,
    });

    if (e.key === "Enter") {
      this.goToSearchPage(input.value);
    } else {
      this.debouncer.trigger();
    }
  }

  private async actuallySearch(): Promise<void> {
    const query = this.state.query;
    const bp = fetchData('search_boundaries', {query});
    const tp = fetchData('search_trails', {query, limit: 5});
    const boundaries = await bp;
    const trails = await tp;

    if (query !== this.state.query) {
      return;
    }

    this.updateState({
      ...this.state,
      boundaries: searchBoundariesFromRaw(boundaries),
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
      this.views.showOverview(camera);
    } else {
      this.updateState({
        ...this.state,
        query: '',
      });
    }
  }

  private goToSearchPage(query: string): void {
    this.views.showSearchResults({query});
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
              latLngFromBase64E7(t.marker),
              t.elevation_down_meters,
              t.elevation_up_meters,
              t.length_meters,
              t.boundaries.map(id => ({id, ...raw.boundaries[id]})),
          ));
}

