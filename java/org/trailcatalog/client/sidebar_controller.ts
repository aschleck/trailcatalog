import { Controller } from 'js/corgi/controller';
import { EmptyDeps } from 'js/corgi/deps';

export interface State {
  open: boolean;
}

export class SidebarController extends Controller<{}, EmptyDeps, HTMLElement, State> {

  toggleSidebarOpen(): void {
    this.updateState({
      ...this.state,
      open: !this.state.open,
    });
  }
}

