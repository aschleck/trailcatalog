import { EmptyDeps } from '../deps';
import { Service, ServiceResponse } from '../service';

interface Listener {
  urlChanged(active: URL): Promise<void>;
}

interface State {
  depth: number;
}

export class HistoryService extends Service<EmptyDeps> {

  private readonly listeners: Set<Listener>;

  constructor(response: ServiceResponse<EmptyDeps>) {
    super(response);
    this.listeners = new Set();

    window.addEventListener('click', (e: Event) => {
      let cursor: Element|null = e.target as Element;
      while (cursor && cursor.tagName !== 'A') {
        cursor = cursor.parentElement;
      }
      if (cursor) {
        const href = cursor.getAttribute('href');
        const target = cursor.getAttribute('target');
        if (href && href.startsWith('/') && target !== '_blank') {
          e.preventDefault();
          this.goTo(href);
        }
      }
    });
    window.addEventListener('popstate', (e: PopStateEvent) => {
      this.notifyListeners();
    });
  }

  addListener(listener: Listener): void {
    this.listeners.add(listener);
  }

  back(): void {
    window.history.back();
  }

  backStaysInApp(): boolean {
    return getState().depth > 0;
  }

  goTo(url: string, state?: object): void {
    const newState = {depth: getState().depth + 1};
    window.history.pushState(newState, '', url);
    this.notifyListeners();
  }

  reload(): Promise<void> {
    return this.notifyListeners();
  }

  replaceTo(url: string): void {
    window.history.replaceState(getState(), '', url);
    this.notifyListeners();
  }

  silentlyReplaceUrl(url: string, state?: object): void {
    window.history.replaceState(getState(), '', url);
  }

  private notifyListeners(): Promise<void> {
    // url might just be a relative path, so we pull the real href from the window.
    const active = new URL(window.location.href);
    const promises = [];
    for (const listener of this.listeners) {
      promises.push(listener.urlChanged(active));
    }
    return Promise.all(promises).then(() => {});
  }
}

function getState(): State {
  if (window.history.state) {
    return window.history.state as State;
  } else {
    return {depth: 0};
  }
}

