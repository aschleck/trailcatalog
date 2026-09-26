import { S2LatLng } from 'java/org/trailcatalog/s2';
import { EventSource, Layer } from 'js/map/layer';

import { POINT_PLACED, TOOL_REQUESTED } from './events';

/** Turns clicks into points while the point tool is up. */
export class PointToolLayer extends Layer {

  private active: boolean;

  constructor() {
    super(/* copyright= */ []);
    this.active = false;
  }

  setActive(active: boolean): void {
    this.active = active;
  }

  override click(
      point: S2LatLng, px: [number, number], contextual: boolean, source: EventSource): boolean {
    if (!this.active || contextual) {
      return false;
    }

    source.trigger(POINT_PLACED, {
      latE7: Math.round(point.latDegrees() * 1e7),
      lngE7: Math.round(point.lngDegrees() * 1e7),
    });
    return true;
  }

  // Claimed so that the layers below don't highlight what the pointer crosses on the way to a
  // click.
  override hover(point: S2LatLng, source: EventSource): boolean {
    return this.active;
  }

  override keyPressed(key: string, source: EventSource): boolean {
    if (!this.active || key !== 'Escape') {
      return false;
    }

    source.trigger(TOOL_REQUESTED, {tool: 'pointer'});
    return true;
  }
}
