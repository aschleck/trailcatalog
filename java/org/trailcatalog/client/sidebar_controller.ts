import { Controller } from 'js/corgi/controller';
import { EmptyDeps } from 'js/corgi/deps';

import { LatLngRect, LatLngZoom } from './common/types';

export interface State {
  camera: LatLngRect|LatLngZoom; // TODO: this is awkward
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

