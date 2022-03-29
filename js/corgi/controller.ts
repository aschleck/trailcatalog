import { Disposable } from './disposable';
import { EventSpec, qualifiedName } from './events';

export interface ControllerResponse<ET extends HTMLElement> {
  root: ET;
  args: any;
}

export class Controller<
    ET extends HTMLElement,
    R extends ControllerResponse<ET>,
> extends Disposable {

  protected readonly root: ET;

  constructor(private response: R) {
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

