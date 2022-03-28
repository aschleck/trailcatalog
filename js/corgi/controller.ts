import { Disposable } from './disposable';

export class Controller<ET extends HTMLElement> extends Disposable {

  constructor(protected readonly root: ET) {
    super();
  }
}

