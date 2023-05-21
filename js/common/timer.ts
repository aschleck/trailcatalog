import { Disposable } from './disposable';

export class Timer extends Disposable {

  private current: number|undefined;

  constructor(
      private readonly delayMs: number,
      private readonly callback: () => void) {
    super();
    this.registerDisposer(() => {
      this.stop();
    });
  }

  start(): void {
    this.stop();
    this.current = setTimeout(() => {
      this.fire();
    }, this.delayMs);
  }

  stop(): void {
    if (this.current !== undefined) {
      clearTimeout(this.current);
      this.current = undefined;
    }
  }

  private fire(): void {
    this.callback();

    this.current = setTimeout(() => {
      this.fire();
    }, this.delayMs);
  }
}
