export class Debouncer {

  private currentTimer: number|undefined;

  constructor(
      private readonly delayMs: number,
      private readonly callback: () => void) {
  }

  trigger(): void {
    if (this.currentTimer !== undefined) {
      clearTimeout(this.currentTimer);
    }
    this.currentTimer = setTimeout(() => {
      this.currentTimer = undefined;
      this.callback();
    }, this.delayMs);
  }
}
