import { checkExists, checkState } from './asserts';
import { WorkerPool } from './worker_pool';

export class Task<V> {

  private _cancelled = false;
  private _completed = false;
  private _result: V|undefined = undefined;

  get cancelled(): boolean {
    return this._cancelled;
  }

  get completed(): boolean {
    return this._completed;
  }

  get result(): V {
    checkState(this._completed, 'Task is not completed yet.');
    return this._result as V;
  }

  cancel(): void {
    this._cancelled = true;
  }

  complete(result: V): void {
    this._completed = true;
    this._result = result;
  }
}

export class QueuedWorkerPool<I, O> {

  private readonly active: Map<number, Task<O>>;
  private readonly pending: Array<[message: I, transfer: Transferable[], result: Task<O>]>;
  private readonly workers: Worker[];

  constructor(url: string, count: number) {
    this.active = new Map();
    this.pending = [];
    this.workers = [];

    for (let i = 0; i < count; ++i) {
      this.workers.push(new Worker(url));
    }
  }

  set onresponse(fn: (e: O) => void) {
    for (let i = 0; i < this.workers.length; ++i) {
      const worker = this.workers[i];
      worker.onmessage = (e) => {
        const task = this.active.get(i);
        this.active.delete(i);

        while (this.pending.length > 0) {
          const [message, transfer, result] = checkExists(this.pending.shift());
          if (result.cancelled) {
            continue;
          }

          worker.postMessage(message, transfer);
          this.active.set(i, result);
          break;
        }

        if (task && !task.cancelled) {
          task.complete(e.data);
          fn(e.data);
        } else if (!task) {
          // For usecases that aren't 1:1 responses that use broadcast instead of post, still return
          // data.
          fn(e.data);
        }
      };
    }
  }

  broadcast(message: I, transfer?: Transferable[]): void {
    for (const worker of this.workers) {
      worker.postMessage(message, transfer ?? []);
    }
  }

  post(message: I, transfer?: Transferable[]): Task<O> {
    const result = new Task<O>();
    for (let i = 0; i < this.workers.length; ++i) {
      if (!this.active.has(i)) {
        const worker = this.workers[i];
        worker.postMessage(message, transfer ?? []);
        this.active.set(i, result);
        return result;
      }
    }

    this.pending.push([message, transfer ?? [], result]);
    return result;
  }
}
