import { S2LatLng, S2LatLngRect } from 'java/org/trailcatalog/s2';

import { Copyright } from '../common/types';
import { EventSource, Layer } from '../layer';
import { Planner } from '../rendering/planner';

export class CompositeZoomLayer extends Layer {

  private lastZoom: number;

  constructor(private readonly layers: Array<[minZoom: number, layer: Layer]>) {
    super();
    this.lastZoom = -1;
    this.layers.sort((a, b) => a[0] - b[0]);
  }

  override get copyrights(): Copyright[] {
    const layer = this.findActive();
    if (layer) {
      return layer.copyrights;
    } else {
      return [];
    }
  }

  override click(point: S2LatLng, px: [number, number], contextual: boolean, source: EventSource):
      boolean {
    const layer = this.findActive();
    if (layer) {
      return layer.click(point, px, contextual, source);
    } else {
      return false;
    }
  }

  override hasNewData(): boolean {
    const layer = this.findActive();
    if (layer) {
      return layer.hasNewData();
    } else {
      return false;
    }
  }

  override hover(point: S2LatLng, source: EventSource): boolean {
    const layer = this.findActive();
    if (layer) {
      return layer.hover(point, source);
    } else {
      return false;
    }
  }

  override render(planner: Planner): void {
    this.findActive()?.render(planner);
  }

  override viewportChanged(bounds: S2LatLngRect, zoom: number): void {
    this.lastZoom = zoom;
    this.findActive()?.viewportChanged(bounds, zoom);
  }

  private findActive(): Layer|undefined {
    let candidate;
    for (let i = 0; i < this.layers.length; ++i) {
      if (this.layers[i][0] <= this.lastZoom) {
        candidate = this.layers[i][1];
      } else {
        break;
      }
    }
    return candidate;
  }
}

