import { S2LatLng, S2LatLngRect } from 'java/org/trailcatalog/s2';
import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';
import { checkExhaustive } from 'js/common/asserts';
import { FetchThrottler } from 'js/common/fetch_throttler';

interface InitializeRequest {
  kind: 'ir';
}

interface RenderRequest {
  kind: 'rr';
  token: string;
  data: ArrayBuffer;
}

export type Request = InitializeRequest|RenderRequest;

interface RenderResponse {
  kind: 'rr';
  token: string;
  geometry: ArrayBuffer;
}

export type Response = RenderResponse;

class CollectionRenderer {

  constructor(
      private readonly postMessage: (response: Response, transfer?: Transferable[]) => void,
  ) {}

  render(request: RenderRequest) {
  }
}

function start(ir: InitializeRequest) {
  const fetcher = new CollectionRenderer((self as any).postMessage.bind(self));
  self.onmessage = e => {
    const request = e.data as Request;
    if (request.kind === 'ir') {
      throw new Error('Already initialized');
    } else if (request.kind === 'rr') {
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
