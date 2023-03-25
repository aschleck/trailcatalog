import { Debouncer } from 'js/common/debouncer';
import { Disposable } from 'js/common/disposable';

import { SupportedElement } from './dom';
import { EventSpec, qualifiedName } from './events';
import { ServiceDeps } from './service';
import { DepsConstructed, DepsConstructorsFor } from './types';

export type ControllerDeps = ServiceDeps & {
  controllers: {[ref: string]: Controller<any, any, any, any>};
  controllerss: {[ref: string]: Array<Controller<any, any, any, any>>};
};

export type ControllerDepsMethod = () => DepsConstructorsFor<ControllerDeps>;

export interface ControllerCtor<C extends Controller<any, any, any, any>> {
  deps?(): ReturnType<C['_D']>;
  new (response: Response<C>): C;
}

export type Response<out C extends Controller<any, any, any, any>> = {
  root: C['_E'];
  args: C['_A'];
  deps: DepsConstructed<ReturnType<C['_D']>>;
  state: [C['_S'], (newState: any) => void];
};

export class Controller<
    A extends {},
    D extends ControllerDepsMethod,
    E extends SupportedElement,
    S,
> extends Disposable {

  readonly _A!: A;
  readonly _D!: D;
  readonly _E!: E;
  readonly _S!: S;
  readonly _R!: typeof this;

  protected readonly root: E;
  protected state: S;
  private readonly updateStateDebouncer: Debouncer;

  constructor(response: Response<Controller<A, D, E, S>>) {
    super();
    this.root = response.root;
    this.state = response.state[0];
    this.updateStateDebouncer = new Debouncer(0, () => {
      if (!this.isDisposed) {
        response.state[1](this.state);
      }
    });
  }

  updateArgs(newArgs: A): void {}

  protected trigger<D>(spec: EventSpec<D>, detail: D): void {
    this.root.dispatchEvent(new CustomEvent(qualifiedName(spec), {
      bubbles: true,
      cancelable: true,
      detail,
    }));
  }

  protected updateState(newState: S): Promise<void> {
    this.state = newState;
    return this.updateStateDebouncer.trigger();
  }

  wakeup(): void {}
}

