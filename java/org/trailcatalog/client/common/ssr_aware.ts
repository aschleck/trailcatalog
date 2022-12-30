import { deepEqual } from 'js/common/comparisons';
import { fetchDeps } from 'js/corgi/binder';
import { HistoryService } from 'js/corgi/history/history_service';

export interface InitialDataKey {
  type: string;
}

declare global {
  interface Window {
    INITIAL_DATA?: {
      keys: object[];
      values: object[];
    };
    SERVER_SIDE_RENDER?: {
      currentUrl(): string;
      initialData<K extends InitialDataKey>(key: K): object|undefined;
      language(): string;
      redirect(url: string): void;
    };
  }
}

export function currentUrl(): URL {
  return new URL(window.SERVER_SIDE_RENDER?.currentUrl() ?? window.location.href);
}

export function initialData<K extends InitialDataKey>(key: K): object|undefined {
  if (window.SERVER_SIDE_RENDER) {
    return window.SERVER_SIDE_RENDER.initialData(key);
  } else if (window.INITIAL_DATA) {
    for (let i = 0; i < window.INITIAL_DATA.keys.length; ++i) {
      if (deepEqual(key, window.INITIAL_DATA.keys[i])) {
        return window.INITIAL_DATA.values[i];
      }
    }
  }
  return undefined;
}

export function isServerSide(): boolean {
  return !!window.SERVER_SIDE_RENDER;
}

export function getLanguage(): string {
  return window.SERVER_SIDE_RENDER?.language() ?? window.navigator.language;
}

export function redirect(url: string): void {
  if (window.SERVER_SIDE_RENDER) {
    window.SERVER_SIDE_RENDER.redirect(url);
  } else {
    fetchDeps({
      services: {history: HistoryService},
    }).then(deps => {
      deps.services.history.replaceTo(url);
    });
  }
}
