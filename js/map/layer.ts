import { S2LatLng, S2LatLngRect } from 'java/org/trailcatalog/s2';
import { Disposable } from 'external/dev_april_corgi+/js/common/disposable';
import { EventSpec } from 'external/dev_april_corgi+/js/corgi/events';

import { SphericalCone } from './camera';
import { Copyright } from './common/types';
import { Planner } from './rendering/planner';

export abstract class Layer extends Disposable {

  constructor(private readonly _copyrights: Copyright[]|undefined = undefined) {
    super();
  }

  get copyrights(): Copyright[] {
    return this._copyrights ?? [];
  }

  click(point: S2LatLng, px: [number, number], contextual: boolean, source: EventSource): boolean {
    return false;
  }

  /** Claims a press for dragging, or returns false to let it pan the map. */
  dragStart(point: S2LatLng, px: [number, number], source: EventSource): boolean {
    return false;
  }

  drag(point: S2LatLng, source: EventSource): void {}

  // Moved is false when the press never left the click radius, and the click follows.
  dragEnd(point: S2LatLng, moved: boolean, source: EventSource): void {}

  hasNewData(): boolean {
    return false;
  }

  hover(point: S2LatLng, source: EventSource): boolean {
    return false;
  }

  // Called on the layers under whichever one claimed the hover, and on every layer when the pointer
  // leaves the map, so a layer that holds a highlight can drop it.
  hoverLost(source: EventSource): void {}

  keyPressed(key: string, source: EventSource): boolean {
    return false;
  }

  loadingData(): boolean {
    return false;
  }

  render(planner: Planner, zoom: number): void {}

  viewportChanged(
      bounds: S2LatLngRect, zoom: number, fetchZoom: number, cone?: SphericalCone): void {}
}

export interface EventSource {
  trigger<D>(spec: EventSpec<D>, detail: D): void;
}
