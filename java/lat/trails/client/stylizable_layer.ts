import { checkExhaustive } from 'js/common/asserts';
import { Layer } from 'js/map2/layer';
import { Command as FetcherCommand, LoadCellCommand, Request as FetcherRequest, UnloadCellsCommand } from 'js/map2/workers/s2_data_fetcher';

import { Request as RendererRequest } from './workers/collection_renderer';

interface ProcessedCell {

}

export class StylizableLayer extends Layer {

  private readonly fetcher: Worker;
  private readonly renderer: Worker;

  constructor(url: string) {
    super();
    this.fetcher = new Worker('/static/s2_data_fetcher.js');
    this.renderer = new Worker('/static/s2_data_fetcher.js');
    this.postFetcherRequest({
      kind: 'ir',
      url,
    });
    this.postRendererRequest({
      kind: 'ir',
    });

    this.fetcher.onmessage = e => {
      const command = e.data as FetcherCommand;
      if (command.kind === 'lcc') {
        this.loadCell(command);
      } else if (command.kind === 'ucc') {
        this.unloadCells(command);
      } else {
        checkExhaustive(command);
      }
    };
  }

  private loadCell(command: LoadCellCommand): void {
  }

  private unloadCells(command: UnloadCellsCommand): void {
  }

  private postFetcherRequest(request: FetcherRequest) {
    this.fetcher.postMessage(request);
  }

  private postRendererRequest(request: RendererRequest) {
    this.fetcher.postMessage(request);
  }
}
