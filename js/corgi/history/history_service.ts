import { EmptyDeps } from '../deps';
import { Service, ServiceResponse } from '../service';

interface Listener {
  urlChanged(active: URL): void;
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
        if (href && href.startsWith('/')) {
          e.preventDefault();
          this.goTo(href);
        }
      }
    });
    window.addEventListener('popstate', (e: PopStateEvent) => {
      this.notifyListeners(new URL(window.location.href));
    });
  }

  addListener(listener: Listener): void {
    this.listeners.add(listener);
  }

  goTo(url: string, state?: object): void {
    // url might just be a relative path, so we pull the real href from the window.
    window.history.pushState(state, '', url);
    this.notifyListeners(new URL(window.location.href));
  }

  reload(): void {
    this.notifyListeners(new URL(window.location.href));
  }

  replaceTo(url: string, state?: object): void {
    // url might just be a relative path, so we pull the real href from the window.
    window.history.replaceState(state, '', url);
    this.notifyListeners(new URL(window.location.href));
  }

  silentlyReplaceUrl(url: string, state?: object): void {
    window.history.replaceState(state, '', url);
  }

  private notifyListeners(active: URL) {
    for (const listener of this.listeners) {
      listener.urlChanged(active);
    }
  }
}

