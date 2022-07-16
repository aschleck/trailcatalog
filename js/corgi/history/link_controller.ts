import { Controller, Response } from 'js/corgi/controller';

import { HistoryService } from './history_service';

export interface State {}

type Deps = typeof LinkController.deps;

export class LinkController extends Controller<{}, Deps, HTMLAnchorElement, State> {

  static deps() {
    return {
      services: {
        history: HistoryService,
      },
    };
  }

  protected readonly history: HistoryService;

  constructor(response: Response<LinkController>) {
    super(response);
    this.history = response.deps.services.history;
  }

  onClick(): void {
    this.history.goTo(this.root.href);
  }
}

