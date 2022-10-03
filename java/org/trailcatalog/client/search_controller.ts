import { checkExists } from 'js/common/asserts';
import { Debouncer } from 'js/common/debouncer';
import { Controller, Response } from 'js/corgi/controller';

import { LatLng } from './common/types';
import { TrailSearchResult } from './models/types';
import { ViewsService } from './views/views_service';

import { DataResponses, fetchData } from './data';

type Deps = typeof SearchController.deps;

export interface State {
  boundaries: Array<{
    id: bigint;
    name: string;
    type: number;
  }>;
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
  private lastQuery: string;

  constructor(response: Response<SearchController>) {
    super(response);
    this.lastQuery = '';
    this.views = response.deps.services.views;

    this.debouncer = new Debouncer(200 /* ms */, () => {
      this.actuallySearch(this.lastQuery);
    });
  }

  search(e: KeyboardEvent): void {
    const input = checkExists(e.srcElement) as HTMLInputElement;
    this.lastQuery = input.value;

    if (e.key === "Enter") {
      this.goToSearchPage();
    } else {
      this.debouncer.trigger();
    }
  }

  private async actuallySearch(query: string): Promise<void> {
    const bp = fetchData('search_boundaries', {query});
    const tp = fetchData('search_trails', {query});

    this.updateState({
      boundaries: (await bp).results.map(({id, name, type}) => ({
        id: BigInt(id),
        name,
        type,
      })),
      query,
      trails: searchTrailsFromRaw(await tp),
    });
  }

  private goToSearchPage(): void {
    this.views.showSearchResults({
      query: this.lastQuery,
    });
  }
}

export function searchTrailsFromRaw(raw: DataResponses['search_trails']): TrailSearchResult[] {
  return raw.results.map(
      t =>
          new TrailSearchResult(
              BigInt(t.id),
              t.name,
              [0, 0] as LatLng,
              t.length_meters));
}
