import { Disposable } from './disposable';
import { EventSpec, qualifiedName } from './events';

export interface ControllerResponse<A, E extends HTMLElement, S> {
  root: E;
  args: A;
  state: [S, (newState: S) => void];
}

export class Controller<
    A,
    E extends HTMLElement,
    S,
    R extends ControllerResponse<A, E, S>,
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

