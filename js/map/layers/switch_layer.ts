import { S2LatLngRect } from 'java/org/trailcatalog/s2';

import { ScreenProjection, SphericalCone } from '../camera';
import { Copyright } from '../common/types';
import { Layer } from '../layer';
import { Planner } from '../rendering/planner';

export interface Viewport {
  bounds: S2LatLngRect;
  zoom: number;
  fetchZoom: number;
  cone?: SphericalCone;
}

/**
 * Shows one of several layers by key, making each when it's shown and disposing it when another
 * replaces it.
 */
export class SwitchLayer<K extends string, L extends Layer> extends Layer {

  private key: K;
  private layer: L;
  private viewport: Viewport|undefined;

  constructor(key: K, private readonly create: (key: K) => L) {
    super();
    this.key = key;
    this.layer = this.adopt(this.create(key));
    this.viewport = undefined;
    this.registerDisposer(() => { this.layer.dispose(); });
  }

  get current(): L {
    return this.layer;
  }

  show(key: K): void {
    if (key === this.key) {
      return;
    }
    this.layer.dispose();
    this.key = key;
    this.layer = this.adopt(this.create(key));
    this.redraw();
    if (this.viewport) {
      const {bounds, zoom, fetchZoom, cone} = this.viewport;
      this.layer.viewportChanged(bounds, zoom, fetchZoom, cone);
    }
  }

  override get copyrights(): Copyright[] {
    return this.layer.copyrights;
  }

  override loadingData(): boolean {
    return this.layer.loadingData();
  }

  override render(planner: Planner, zoom: number, projection: ScreenProjection): void {
    this.layer.render(planner, zoom, projection);
  }

  override viewportChanged(
      bounds: S2LatLngRect, zoom: number, fetchZoom: number, cone?: SphericalCone): void {
    this.viewport = {bounds, zoom, fetchZoom, cone};
    this.layer.viewportChanged(bounds, zoom, fetchZoom, cone);
  }
}
