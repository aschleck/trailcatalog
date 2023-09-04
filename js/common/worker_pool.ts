export class WorkerPool<I, O> {

  private readonly workers: Worker[];
  private last: number;

  constructor(url: string, count: number) {
    this.workers = [];
    this.last = -1;
    for (let i = 0; i < count; ++i) {
      this.workers.push(new Worker(url));
    }
  }

  set onresponse(fn: (e: O) => void) {
    for (const worker of this.workers) {
      worker.onmessage = (e) => { fn(e.data); };
    }
  }

  broadcast(message: I, transfer?: Transferable[]): void {
    for (const worker of this.workers) {
      worker.postMessage(message, transfer ?? []);
    }
  }

  post(message: I, transfer?: Transferable[]): void {
    this.workers[++this.last % this.workers.length].postMessage(message, transfer ?? []);
  }
}
