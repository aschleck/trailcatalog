import { Controller, ControllerResponse } from 'js/corgi/controller';
import { EmptyDeps } from 'js/corgi/deps';

export interface State {
  open: boolean;
}

interface Response extends ControllerResponse<undefined, EmptyDeps, HTMLElement, State> {
  state: [State, (newState: State) => void];
}

export class SidebarController extends Controller<undefined, EmptyDeps, HTMLElement, State, Response> {

  toggleSidebarOpen(): void {
    this.updateState({
      ...this.state,
      open: !this.state.open,
    });
  }
}

