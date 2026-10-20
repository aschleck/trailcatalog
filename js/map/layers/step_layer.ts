import { S2LatLngRect } from 'java/org/trailcatalog/s2';

import { ScreenProjection, SphericalCone } from '../camera';
import { Copyright } from '../common/types';
import { Layer } from '../layer';
import { Planner } from '../rendering/planner';

import { Viewport } from './switch_layer';

/**
 * Shows the layer for one key, like a forecast step's URL, while loading the layers for the keys
 * expected next. A new key keeps the old layer on screen until its own layer is ready, so stepping
 * through keys never shows a half loaded layer.
 */
export class StepLayer<L extends Layer & {readonly ready: boolean}> extends Layer {

  private readonly layers: Map<string, L>;
  private shownKey: string;
  private wantedKey: string;
  // Every key show was last told about, whose layers stay alive
  private kept: Set<string>;
  private swapped: boolean;
  private viewport: Viewport|undefined;

  constructor(
      key: string,
      upcoming: string[],
      private readonly create: (key: string) => L) {
    super();
    this.layers = new Map();
    this.shownKey = key;
    this.wantedKey = key;
    this.kept = new Set();
    this.swapped = false;
    this.viewport = undefined;
    this.registerDisposer(() => {
      for (const layer of this.layers.values()) {
        layer.dispose();
      }
    });
    this.show(key, upcoming);
  }

  get current(): L {
    return this.layers.get(this.shownKey)!;
  }

  /** Returns every layer held, shown or loading, so a setting can reach them all. */
  get all(): Iterable<L> {
    return this.layers.values();
  }

  /** Shows the layer for key once it is ready, and starts loading the ones for upcoming. */
  show(key: string, upcoming: string[]): void {
    this.wantedKey = key;
    this.kept = new Set([key, ...upcoming]);
    for (const k of this.kept) {
      if (!this.layers.has(k)) {
        const layer = this.create(k);
        this.layers.set(k, layer);
        if (this.viewport) {
          const {bounds, zoom, fetchZoom, cone} = this.viewport;
          layer.viewportChanged(bounds, zoom, fetchZoom, cone);
        }
      }
    }
    this.swapIfReady();
  }

  override get copyrights(): Copyright[] {
    return this.current.copyrights;
  }

  // The map asks every frame, which is what notices a wanted layer finishing.
  override hasNewData(): boolean {
    this.swapIfReady();
    const swapped = this.swapped;
    this.swapped = false;
    return this.current.hasNewData() || swapped;
  }

  override loadingData(): boolean {
    return this.current.loadingData() || this.layers.get(this.wantedKey)!.loadingData();
  }

  override render(planner: Planner, zoom: number, projection: ScreenProjection): void {
    this.current.render(planner, zoom, projection);
  }

  override viewportChanged(
      bounds: S2LatLngRect, zoom: number, fetchZoom: number, cone?: SphericalCone): void {
    this.viewport = {bounds, zoom, fetchZoom, cone};
    for (const layer of this.layers.values()) {
      layer.viewportChanged(bounds, zoom, fetchZoom, cone);
    }
  }

  private swapIfReady(): void {
    if (this.wantedKey !== this.shownKey && this.layers.get(this.wantedKey)!.ready) {
      this.shownKey = this.wantedKey;
      this.swapped = true;
    }
    // The shown layer stays until its replacement is ready, even once show stops asking for it.
    for (const [key, layer] of this.layers) {
      if (key !== this.shownKey && !this.kept.has(key)) {
        layer.dispose();
        this.layers.delete(key);
      }
    }
  }
}
