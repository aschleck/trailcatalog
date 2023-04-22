import { checkExists } from 'js/common/asserts';
import * as corgi from 'js/corgi';
import { Controller, Response } from 'js/corgi/controller';
import { HistoryService } from 'js/corgi/history/history_service';
import { setUnitSystem, UnitSystem } from 'js/server/ssr_aware';

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
    setUnitSystem(value as UnitSystem);
    corgi.vdomCaching.disable();
    this.history.reload().then(() => {
      corgi.vdomCaching.enable();
    });
  }
}

