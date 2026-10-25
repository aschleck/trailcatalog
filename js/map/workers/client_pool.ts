import { checkArgument, checkExhaustive, checkExists } from 'external/dev_april_corgi+/js/common/asserts';
import { Task } from 'external/dev_april_corgi+/js/common/queued_worker_pool';

// Every layer of a kind shares one pool because each worker is its own JavaScript heap, and phones
// run out of memory at a few hundred of them. Workers start when a client calls start or first
// sends anything, so a layer that is never shown costs nothing.

type ToWorker<Init, Request> =
    {kind: 'connect'; client: number; init: Init}
    |{kind: 'disconnect'; client: number}
    |{kind: 'send'; client: number; message: Request}
    |{kind: 'task'; client: number; message: Request};

type FromWorker<Response> =
    {kind: 'emit'; client: number; message: Response}
    |{kind: 'reply'; client: number; message: Response|undefined};

export interface Reply<Response> {
  message: Response;
  transfer?: Transferable[];
}

// A task's answer. Undefined answers nothing, such as when the work failed.
export type Answer<Response> = Reply<Response>|Promise<Reply<Response>|undefined>|undefined|void;

const POOLS = new Map<string, ClientPool<any, any, any>>();

/** Returns the page's pool for the worker script, creating it with count workers the first time. */
export function sharedPool<Init, Request, Response>(url: string, count: number):
    ClientPool<Init, Request, Response> {
  let pool = POOLS.get(url);
  if (!pool) {
    pool = new ClientPool(url, count);
    POOLS.set(url, pool);
  }
  return pool;
}

// Loaders are CPU bound, so workers past the core count only cost memory. Three kinds of loader share
// the cores, so we stop at 6 even with more.
export function loaderCount(): number {
  return Math.min(navigator.hardwareConcurrency || 2, 6);
}

export class ClientPool<Init, Request, Response> {

  private readonly clients: Map<number, PoolClient<Init, Request, Response>>;
  // The task each busy worker is on, by worker index
  private readonly active: Map<number, {message: Request; result: Task<Response>}>;
  private readonly pending:
      Array<{client: number; message: Request; transfer: Transferable[]; result: Task<Response>}>;
  private workers: Worker[]|undefined;
  private nextClient: number;

  constructor(private readonly url: string, private readonly count: number) {
    this.clients = new Map();
    this.active = new Map();
    this.pending = [];
    this.workers = undefined;
    this.nextClient = 0;
  }

  connect(init: Init): PoolClient<Init, Request, Response> {
    const client = new PoolClient(this, this.nextClient, init);
    this.nextClient += 1;
    this.clients.set(client.id, client);
    return client;
  }

  disconnect(client: PoolClient<Init, Request, Response>, attached: boolean): void {
    this.clients.delete(client.id);
    for (const task of this.pending) {
      if (task.client === client.id) {
        task.result.cancel();
      }
    }
    if (attached) {
      this.broadcast({kind: 'disconnect', client: client.id});
    }
  }

  // Transfers can only go to one worker, so a pool sending them must have just one.
  broadcast(message: ToWorker<Init, Request>, transfer: Transferable[] = []): void {
    const workers = this.start();
    checkArgument(transfer.length === 0 || workers.length === 1);
    for (const worker of workers) {
      worker.postMessage(message, transfer);
    }
  }

  post(client: number, message: Request, transfer: Transferable[]): Task<Response> {
    const workers = this.start();
    const result = new Task<Response>();
    for (let i = 0; i < workers.length; ++i) {
      if (!this.active.has(i)) {
        this.active.set(i, {message, result});
        workers[i].postMessage({kind: 'task', client, message}, transfer);
        return result;
      }
    }

    this.pending.push({client, message, transfer, result});
    return result;
  }

  private start(): Worker[] {
    if (this.workers) {
      return this.workers;
    }

    const workers = [];
    for (let i = 0; i < this.count; ++i) {
      const worker = new Worker(this.url, {type: 'module'});
      worker.onmessage = e => {
        this.receive(i, e.data as FromWorker<Response>);
      };
      workers.push(worker);
    }
    this.workers = workers;
    return workers;
  }

  private receive(worker: number, data: FromWorker<Response>): void {
    if (data.kind === 'reply') {
      const task = this.active.get(worker);
      this.active.delete(worker);
      this.next(worker);
      if (!task || task.result.cancelled) {
        return;
      }
      if (data.message === undefined) {
        // Cancelled so that nothing completes it later
        task.result.cancel();
        this.clients.get(data.client)?.onfailure(task.message, task.result);
        return;
      }
      task.result.complete(data.message);
      this.clients.get(data.client)?.onresponse(data.message);
    } else if (data.kind === 'emit') {
      // The client may have disconnected while the worker was busy
      this.clients.get(data.client)?.onresponse(data.message);
    } else {
      checkExhaustive(data);
    }
  }

  private next(worker: number): void {
    while (this.pending.length > 0) {
      const {client, message, transfer, result} = checkExists(this.pending.shift());
      if (result.cancelled) {
        continue;
      }

      this.active.set(worker, {message, result});
      checkExists(this.workers)[worker].postMessage({kind: 'task', client, message}, transfer);
      return;
    }
  }
}

/** One layer's connection to a pool, which carries its own state in each worker. */
export class PoolClient<Init, Request, Response> {

  onresponse: (response: Response) => void;
  // Called when a task's work threw or had nothing to answer with
  onfailure: (request: Request, task: Task<Response>) => void;
  private attached: boolean;

  constructor(
      private readonly pool: ClientPool<Init, Request, Response>,
      readonly id: number,
      private readonly init: Init,
  ) {
    this.onresponse = () => {};
    this.onfailure = () => {};
    this.attached = false;
  }

  // Connects to the pool, starting its workers if they aren't running. Layers call this when shown
  // so the worker scripts download before the fetcher's requests, which can otherwise take every
  // connection to the origin and leave the scripts waiting behind them.
  start(): void {
    if (!this.attached) {
      this.attached = true;
      this.pool.broadcast({kind: 'connect', client: this.id, init: this.init});
    }
  }

  /** Sends to every worker in the pool, without waiting for a free one. */
  broadcast(message: Request, transfer?: Transferable[]): void {
    this.start();
    this.pool.broadcast({kind: 'send', client: this.id, message}, transfer);
  }

  /** Queues work for the next free worker. Its reply completes the task. */
  post(message: Request, transfer?: Transferable[]): Task<Response> {
    this.start();
    return this.pool.post(this.id, message, transfer ?? []);
  }

  dispose(): void {
    this.pool.disconnect(this, this.attached);
  }

  private attach(): void {
    if (!this.attached) {
      this.attached = true;
      this.pool.broadcast({kind: 'connect', client: this.id, init: this.init});
    }
  }
}

/**
 * Runs the worker side of a pool. Each client gets a handler from start when it connects, whose
 * answer to a task is posted back as its reply.
 */
export function serveClients<Init, Request, Response>(
    start: (init: Init, emit: (message: Response, transfer?: Transferable[]) => void) =>
        (request: Request) => Answer<Response>): void {
  const post = (self as any).postMessage.bind(self) as
      (message: FromWorker<Response>, transfer: Transferable[]) => void;
  const clients = new Map<number, (request: Request) => Answer<Response>>();
  self.onmessage = e => {
    const data = e.data as ToWorker<Init, Request>;
    const client = data.client;
    if (data.kind === 'connect') {
      clients.set(client, start(data.init, (message, transfer) => {
        post({kind: 'emit', client, message}, transfer ?? []);
      }));
    } else if (data.kind === 'disconnect') {
      clients.delete(client);
    } else if (data.kind === 'send') {
      checkExists(clients.get(client))(data.message);
    } else if (data.kind === 'task') {
      const handle = checkExists(clients.get(client));
      // The pool holds this worker until the reply, so a failed task still has to send one.
      new Promise<Reply<Response>|undefined|void>(resolve => { resolve(handle(data.message)); })
          .catch(e => {
            console.error(e);
            return undefined;
          })
          .then(reply => {
            post({kind: 'reply', client, message: reply?.message}, reply?.transfer ?? []);
          });
    } else {
      checkExhaustive(data);
    }
  };
}
