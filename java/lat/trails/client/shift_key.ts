import { Disposable } from 'external/dev_april_corgi+/js/common/disposable';

/** Tracks whether shift is down and calls onChanged when that flips. */
export class ShiftKey extends Disposable {

  private _held: boolean;

  constructor(private readonly onChanged: (held: boolean) => void) {
    super();
    this._held = false;

    // Read from shiftKey rather than key, so that any keystroke corrects a missed shift release.
    this.registerListener(window, 'keydown', e => {
      this.set(e.shiftKey);
    });
    this.registerListener(window, 'keyup', e => {
      this.set(e.shiftKey);
    });
    // A shift released while another window has focus sends us no keyup.
    this.registerListener(window, 'blur', () => {
      this.set(false);
    });
  }

  get held(): boolean {
    return this._held;
  }

  private set(held: boolean): void {
    if (held !== this._held) {
      this._held = held;
      this.onChanged(held);
    }
  }
}
