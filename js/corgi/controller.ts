import { Disposable } from 'js/common/disposable';

import { EmptyDeps } from './deps';
import { EventSpec, qualifiedName } from './events';
import { ServiceDeps, RequestSpec as ServiceRequestSpec } from './service';

export type ControllerDeps = ServiceDeps;

export type RequestSpec<D extends ControllerDeps> = ServiceRequestSpec<D>;

export interface ControllerCtor<
    A,
    D extends ControllerDeps,
    E extends HTMLElement,
    S,
    R extends ControllerResponse<A, D, E, S>,
    C extends Controller<A, D, E, S, R>> {
  deps?(): RequestSpec<D>;
  new (response: R): C;
}

export interface ControllerResponse<A, D extends ControllerDeps, E extends HTMLElement, S> {
  root: E;
  args: A;
  deps: D;
  state: [S, (newState: S) => void];
}

export class Controller<
    A,
    D extends ControllerDeps,
    E extends HTMLElement,
    S,
    R extends ControllerResponse<A, D, E, S>,
> extends Disposable {

  protected readonly root: E;
  protected state: S;
  private readonly stateUpdater: (newState: S) => void;

  constructor(response: R) {
    super();
    this.root = response.root;
    this.state = response.state[0];
    this.stateUpdater = response.state[1];
  }

  protected trigger<D>(spec: EventSpec<D>, detail: D): void {
    this.root.dispatchEvent(new CustomEvent(qualifiedName(spec), {
      bubbles: true,
      cancelable: true,
      detail,
    }));
  }

  protected updateState(newState: S): void {
    this.stateUpdater(newState);
    this.state = newState;
  }

  wakeup(): void {}
}

