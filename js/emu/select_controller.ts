import { Controller, Response } from 'js/corgi/controller';
import { EmptyDeps } from 'js/corgi/deps';
import { CorgiEvent } from 'js/corgi/events';

import { CHANGED } from './events';

interface Args {}

export interface State {
}

export class SelectController extends Controller<Args, EmptyDeps, HTMLSelectElement, State> {

  constructor(response: Response<SelectController>) {
    super(response);
  }

  get value(): string {
    return this.root.value;
  }

  changed(e: Event): void {
    this.trigger(CHANGED, {value: this.value});
  }
}

