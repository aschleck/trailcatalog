/**
 * Asks about the latest input with at most one question in flight. The pointer moves faster than
 * the worker answers, so asking on every move would queue questions up behind each other.
 */
export class LatestQuery<I, O> {

  private _latest: O|undefined;
  private asking: boolean;
  // Set while a question is in flight, for the one to ask once it lands
  private next: {input: I}|undefined;
  private waiters: Array<() => void>;

  constructor(private readonly ask: (input: I) => Promise<O>) {
    this._latest = undefined;
    this.asking = false;
    this.next = undefined;
    this.waiters = [];
  }

  /** The answer to the last question that landed, or undefined before the first does. */
  get latest(): O|undefined {
    return this._latest;
  }

  set(input: I): void {
    this.next = {input};
    if (!this.asking) {
      this.askNext();
    }
  }

  /** Resolves once the latest input has been answered, or right away if nothing is in flight. */
  settled(): Promise<void> {
    return this.asking ? new Promise(resolve => this.waiters.push(resolve)) : Promise.resolve();
  }

  private askNext(): void {
    const next = this.next;
    if (!next) {
      this.asking = false;
      const waiters = this.waiters;
      this.waiters = [];
      for (const waiter of waiters) {
        waiter();
      }
      return;
    }

    this.next = undefined;
    this.asking = true;
    this.ask(next.input).then(output => {
      this._latest = output;
      this.askNext();
    });
  }
}
