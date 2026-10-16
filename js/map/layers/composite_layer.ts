import { S2LatLngRect } from 'java/org/trailcatalog/s2';

import { ScreenProjection, SphericalCone } from '../camera';
import { Copyright } from '../common/types';
import { Layer } from '../layer';
import { Planner } from '../rendering/planner';

/** Shows several layers as one, such as a raster with vectors drawn over it. */
export class CompositeLayer extends Layer {

  constructor(private readonly layers: Layer[]) {
    super();
    for (const layer of layers) {
      this.registerDisposable(layer);
    }
  }

  override get copyrights(): Copyright[] {
    return [...new Set(this.layers.flatMap(layer => layer.copyrights))];
  }

  override hasNewData(): boolean {
    return this.layers.some(layer => layer.hasNewData());
  }

  override loadingData(): boolean {
    return this.layers.some(layer => layer.loadingData());
  }

  override render(planner: Planner, zoom: number, projection: ScreenProjection): void {
    for (const layer of this.layers) {
      layer.render(planner, zoom, projection);
    }
  }

  override viewportChanged(
      bounds: S2LatLngRect, zoom: number, fetchZoom: number, cone?: SphericalCone): void {
    for (const layer of this.layers) {
      layer.viewportChanged(bounds, zoom, fetchZoom, cone);
    }
  }
}
