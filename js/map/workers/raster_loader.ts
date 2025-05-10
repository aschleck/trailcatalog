import { checkExhaustive } from 'external/dev_april_corgi+/js/common/asserts';

import { TileId } from '../common/types';

interface InitializeRequest {
  kind: 'ir';
}

interface LoadRequest {
  kind: 'lr';
  id: TileId;
  data: ArrayBuffer;
}

export type Request = InitializeRequest|LoadRequest;

export interface LoadResponse {
  kind: 'lr';
  id: TileId;
  bitmap: ImageBitmap;
}

export type Response = LoadResponse;

class RasterLoader {

  constructor(
      private readonly postMessage: (response: Response, transfer?: Transferable[]) => void,
  ) {}

  render(request: LoadRequest) {
    createImageBitmap(new Blob([request.data]))
        .then(bitmap => {
          this.postMessage({
            kind: 'lr',
            id: request.id,
            bitmap,
          }, [bitmap]);
        }, e => {
          console.error(e);
        });
  }
}

function start(ir: InitializeRequest) {
  const fetcher = new RasterLoader((self as any).postMessage.bind(self));
  self.onmessage = e => {
    const request = e.data as Request;
    if (request.kind === 'ir') {
      throw new Error('Already initialized');
    } else if (request.kind === 'lr') {
      fetcher.render(request);
    } else {
      checkExhaustive(request);
    }
  };
}

self.onmessage = e => {
  const request = e.data as Request;
  if (request.kind !== 'ir') {
    throw new Error('Expected an initialization request');
  }

  start(request);
};

