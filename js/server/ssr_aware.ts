import { deepEqual } from 'js/common/comparisons';
import { debugMode } from 'js/common/debug';
import { maybeMemoized } from 'js/common/memoized';
import { fetchGlobalDeps } from 'js/corgi/deps';
import { HistoryService } from 'js/corgi/history/history_service';

import { InitialDataKey } from './data';

export type UnitSystem = 'imperial'|'metric';

const UNIT_SYSTEM_COOKIE = 'unit_system';

function calculateUnitSystem(): UnitSystem {
  const requested =
      (window.SERVER_SIDE_RENDER?.cookies() ?? window.document?.cookie)
          ?.split('; ')
          ?.find(c => c.startsWith(`${UNIT_SYSTEM_COOKIE}=`))
          ?.split('=')[1];
  if (requested === 'imperial' || requested === 'metric') {
    return requested;
  }

  const imperial = getLanguage() === 'en-LR' || getLanguage() === 'en-US' || getLanguage() === 'my';
  return imperial ? 'imperial' : 'metric';
}

const chosenUnitSystem = maybeMemoized(calculateUnitSystem);

export function getUnitSystem(): UnitSystem {
  return chosenUnitSystem.value;
}

export function setUnitSystem(system: UnitSystem) {
  chosenUnitSystem.value = system;

  let secure;
  if (debugMode()) {
    secure = '';
  } else {
    secure =  '; Secure';
  }

  document.cookie = `${UNIT_SYSTEM_COOKIE}=${system}; Path=/; SameSite=Strict${secure}`;
}


declare global {
  interface Window {
    INITIAL_DATA?: {
      keys: object[];
      values: object[];
    };
    SERVER_SIDE_RENDER?: {
      cookies(): string;
      currentUrl(): string;
      initialData<K extends InitialDataKey>(key: K): object|undefined;
      language(): string;
      redirectTo(url: string): void;
      setTitle(title: string): void;
    };
  }
}

class FakeMemoized<T> {

  constructor(private readonly fn: () => T) {}

  get value(): T {
    return this.fn();
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
  return window.SERVER_SIDE_RENDER?.language() ?? window.navigator?.language ?? 'unknown';
}

export function redirectTo(url: string): void {
  if (window.SERVER_SIDE_RENDER) {
    window.SERVER_SIDE_RENDER.redirectTo(url);
  } else {
    fetchGlobalDeps({
      services: {history: HistoryService},
    }).then(deps => {
      deps.services.history.replaceTo(url);
    });
  }
}

export function setTitle(title: string): void {
  if (window.SERVER_SIDE_RENDER) {
    window.SERVER_SIDE_RENDER.setTitle(title);
  } else {
    document.title = title;
  }
}

