import { Disposable } from './disposable';
import { EventSpec, qualifiedName } from './events';

export interface ControllerResponse<A, E extends HTMLElement, S> {
  root: E;
  args: A;
  state: S extends undefined ? undefined : [S, (newState: S) => void];
}

export class Controller<
    A,
    E extends HTMLElement,
    S,
    R extends ControllerResponse<A, E, S>,
> extends Disposable {

  protected readonly root: E;

  constructor(response: R) {
    super();
    this.root = response.root;
  }

  protected trigger<S>(spec: EventSpec<S>, detail: S): void {
    this.root.dispatchEvent(new CustomEvent(qualifiedName(spec), {
      bubbles: true,
      cancelable: true,
      detail,
    }));
  }

  wakeup(): void {}
}

