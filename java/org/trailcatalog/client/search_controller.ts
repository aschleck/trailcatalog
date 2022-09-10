import { checkExists } from 'js/common/asserts';
import { Debouncer } from 'js/common/debouncer';
import { Controller, Response } from 'js/corgi/controller';
import { EmptyDeps } from 'js/corgi/deps';

import { DataResponses, fetchData } from './data';

export interface State {
  boundaries: Array<{
    id: bigint;
    name: string;
    type: number;
  }>;
  query: string;
  trails: Array<{
    id: bigint;
    name: string;
    length_meters: number;
  }>;
}

export class SearchController extends Controller<{}, EmptyDeps, HTMLElement, State> {

  private readonly debouncer: Debouncer;
  private lastQuery: string;

  constructor(response: Response<SearchController>) {
    super(response);
    this.lastQuery = '';

    this.debouncer = new Debouncer(200 /* ms */, () => {
      this.actuallySearch(this.lastQuery);
    });
  }

  search(e: InputEvent): void {
    const input = checkExists(e.srcElement) as HTMLInputElement;
    this.lastQuery = input.value;
    this.debouncer.trigger();
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
      trails: (await tp).results.map(({id, name, length_meters}) => ({
        id: BigInt(id),
        name,
        length_meters,
      }))
    });
  }
}
