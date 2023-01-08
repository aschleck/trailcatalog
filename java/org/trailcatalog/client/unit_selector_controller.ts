import { checkExists } from 'js/common/asserts';
import { Controller, Response } from 'js/corgi/controller';
import { HistoryService } from 'js/corgi/history/history_service';

import { UNIT_SYSTEM_COOKIE } from './common/ssr_aware';
import { UnitSystem } from './common/types';

export interface State {
  system: UnitSystem;
}

type Deps = typeof UnitSelectorController.deps;

export class UnitSelectorController extends Controller<{}, Deps, HTMLElement, State> {

  static deps() {
    return {
      services: {
        history: HistoryService,
      },
    };
  }

  private readonly history: HistoryService;

  constructor(response: Response<UnitSelectorController>) {
    super(response);
    this.history = response.deps.services.history;
  }

  select(e: Event): void {
    const value = (checkExists(e.target) as HTMLInputElement).value;
    // TODO(april): make this secure
    document.cookie = `${UNIT_SYSTEM_COOKIE}=${value}; Path=/; SameSite=Strict`;
    // TODO(april): it's not clear to me that this works correctly or because of a state update bug.
    // Theoretically the route didn't change so everything should be able to avoid being rendered.
    this.history.reload();
  }
}

