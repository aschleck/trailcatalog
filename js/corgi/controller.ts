import { Disposable } from './disposable';

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

  wakeup(): void {}
}

