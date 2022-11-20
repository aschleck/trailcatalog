import { Debouncer } from 'js/common/debouncer';
import { Disposable } from 'js/common/disposable';

import { EventSpec, qualifiedName } from './events';
import { ServiceDeps } from './service';
import { DepsConstructed, DepsConstructorsFor } from './types';

export type ControllerDeps = ServiceDeps;

export type ControllerDepsMethod = () => DepsConstructorsFor<ServiceDeps>;

export interface ControllerCtor<
    A extends {},
    D extends ControllerDepsMethod,
    E extends HTMLElement|SVGElement,
    S,
    R extends ControllerResponse<A, D, E, S>,
    C extends Controller<A, D, E, S>> {
  deps?(): ReturnType<D>;
  new (response: R): C;
}

export interface ControllerResponse<A, D extends ControllerDepsMethod, E, S> {
  root: E;
  args: A;
  deps: DepsConstructed<ReturnType<D>>;
  state: [S, (newState: S) => void];
}

export type Response<C extends Controller<any, any, any, any>> = C['_RT'];

export class Controller<
    A extends {},
    D extends ControllerDepsMethod,
    E extends HTMLElement|SVGElement,
    S,
> extends Disposable {

  readonly _RT!: ControllerResponse<A, D, E, S>;

  protected readonly root: E;
  protected state: S;
  private readonly updateStateDebouncer: Debouncer;

  constructor(response: ControllerResponse<A, D, E, S>) {
    super();
    this.root = response.root;
    this.state = response.state[0];
    this.updateStateDebouncer = new Debouncer(0, () => {
      response.state[1](this.state);
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

  protected updateState(newState: S): void {
    this.state = newState;
    this.updateStateDebouncer.trigger();
  }

  wakeup(): void {}
}

