export const MAX_REQUESTS_IN_FLIGHT = 8;

interface RequestInitWithSignal extends RequestInit {
  signal: AbortSignal;
}

export class FetchThrottler {

  private active: number;
  private queued: Array<() => void>;

  constructor() {
    this.active = 0;
    this.queued = [];
  }

  fetch(input: RequestInfo, init: RequestInitWithSignal): Promise<Response> {
    if (this.active < MAX_REQUESTS_IN_FLIGHT) {
      return this.executeFetch(input, init);
    } else {
      return new Promise<void>((resolve, reject) => {
        this.queued.push(resolve);
      }).then(() => {
        if (init.signal.aborted) {
          this.maybeTriggerQueued();
          throw new AbortError();
        } else {
          return this.executeFetch(input, init);
        }
      });
    }
  }

  private executeFetch(input: RequestInfo, init: RequestInitWithSignal): Promise<Response> {
    this.active += 1;
    return fetch(input, init).finally(() => {
      this.active -= 1;
      this.maybeTriggerQueued();
    });
  }

  private maybeTriggerQueued(): void {
    const trigger = this.queued.shift();
    if (trigger) {
      trigger();
    }
  }
}

class AbortError extends Error {

  readonly name = 'AbortError';

  constructor() {
    super('Request was aborted while throttled');
  }
}
