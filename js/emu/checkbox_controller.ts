import { Controller, Response } from 'js/corgi/controller';
import { EmptyDeps } from 'js/corgi/deps';
import { CorgiEvent } from 'js/corgi/events';

import { ACTION } from './events';

interface Args {
}

export interface State {
  checked: boolean;
}

export class CheckboxController extends Controller<Args, EmptyDeps, HTMLInputElement, State> {

  constructor(response: Response<CheckboxController>) {
    super(response);
  }

  clicked(): void {
    this.updateState({
      ...this.state,
      checked: !this.state.checked,
    });
    this.trigger(ACTION, {});
  }

  keyPressed(e: KeyboardEvent): void {
    if (e.key === 'Enter' || e.key === ' ') {
      this.updateState({
        ...this.state,
        checked: !this.state.checked,
      });
      this.trigger(ACTION, {});
    }
  }
}
