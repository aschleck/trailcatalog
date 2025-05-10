import { checkExists } from 'external/dev_april_corgi+/js/common/asserts';
import * as corgi from 'external/dev_april_corgi+/js/corgi';
import { Controller, Response } from 'external/dev_april_corgi+/js/corgi/controller';
import { CorgiEvent } from 'external/dev_april_corgi+/js/corgi/events';
import { HistoryService } from 'external/dev_april_corgi+/js/corgi/history/history_service';
import { ACTION } from 'external/dev_april_corgi+/js/emu/events';

import { setUnitSystem, UnitSystem } from './common/formatters';

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

  select(e: CorgiEvent<typeof ACTION>): void {
    const value = (e.targetElement.element() as HTMLInputElement).value;
    setUnitSystem(value as UnitSystem);
    corgi.vdomCaching.disable();
    this.history.reload().then(() => {
      corgi.vdomCaching.enable();
    });
  }
}

