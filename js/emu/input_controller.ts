import { Controller, Response } from 'js/corgi/controller';
import { EmptyDeps } from 'js/corgi/deps';
import { CorgiEvent } from 'js/corgi/events';

import { ACTION, CHANGED } from './events';

interface Args {
  value: string|undefined;
}

export interface State {
  managed: boolean;
}

export class InputController extends Controller<Args, EmptyDeps, HTMLInputElement, State> {

  private lastValue: string;

  constructor(response: Response<InputController>) {
    super(response);
    this.lastValue = this.root.value;

    // In most cases this controller will wake up when the value changes, so root.value will already
    // be updated and we need to trigger a change.
    if (this.lastValue !== (response.args.value ?? '')) {
      this.trigger(CHANGED, {value: this.value});
    }
  }

  get value(): string {
    return this.root.value;
  }

  keyPressed(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      this.trigger(ACTION, {});
    } else if (this.lastValue !== this.value) {
      this.lastValue = this.value;
      if (this.state.managed) {
        this.updateState({
          managed: false,
        });
      }
      this.trigger(CHANGED, {value: this.value});
    }
  }
}
