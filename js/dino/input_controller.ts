import { Controller, Response } from 'js/corgi/controller';
import { EmptyDeps } from 'js/corgi/deps';
import { CorgiEvent } from 'js/corgi/events';

import { ACTION, CHANGED } from './events';

interface Args {}

export interface State {}

export class InputController extends Controller<Args, EmptyDeps, HTMLInputElement, State> {

  constructor(response: Response<InputController>) {
    super(response);
  }

  get value(): string {
    return this.root.value;
  }

  keyPressed(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      this.trigger(ACTION, {});
    } else {
      this.trigger(CHANGED, {});
    }
  }
}
