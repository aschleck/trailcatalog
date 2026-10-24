import { S2LatLng } from 'java/org/trailcatalog/s2';
import { Camera, projectS2LatLng } from 'js/map/camera';
import { EventSource, Layer } from 'js/map/layer';
import { growBuffer } from 'js/map/rendering/buffers';
import { LineProgram } from 'js/map/rendering/line_program';
import { Planner } from 'js/map/rendering/planner';
import { Drawable } from 'js/map/rendering/program';
import { Renderer } from 'js/map/rendering/renderer';
import { Z_EDITING } from 'js/map/z';

import { toE7Array } from './drawing_layer';
import { MARKER_DRAWN, TOOL_REQUESTED } from './events';
import { outlineMarker, pushMarker, streamline } from './marker';
import { DEFAULT_COLOR, DEFAULT_MARKER_WIDTH_PX, parseColor } from './workers/collection_schema';

// A few seconds of scribbling
const INITIAL_BUFFER_BYTES = 64 * 1024;

interface Stroke {
  // Where the pointer went, in mercator
  inputs: number[];
  zoom: number;
  // Mercator units to a pixel at zoom
  pixel: number;
}

/** Turns drags into freehand strokes while the marker tool is up. */
export class MarkerToolLayer extends Layer {

  private active: boolean;
  private stroke: Stroke|undefined;
  private readonly glGeometry: WebGLBuffer;
  private geometry: ArrayBuffer;
  private drawables: Drawable[];
  private planned: {generation: number; zoom: number};

  constructor(private readonly camera: Camera, private readonly renderer: Renderer) {
    super(/* copyright= */ []);
    this.active = false;
    this.stroke = undefined;
    this.glGeometry = renderer.createDataBuffer(INITIAL_BUFFER_BYTES);
    this.registerDisposer(() => {
      renderer.deleteBuffer(this.glGeometry);
    });
    this.geometry = new ArrayBuffer(INITIAL_BUFFER_BYTES);
    this.drawables = [];
    this.planned = {generation: -1, zoom: -1};
  }

  setActive(active: boolean): void {
    this.active = active;
    this.clear();
  }

  // Swallowed so that a tap doesn't select what is under it.
  override click(
      point: S2LatLng, px: [number, number], contextual: boolean, source: EventSource): boolean {
    return this.active;
  }

  override dragStart(point: S2LatLng, px: [number, number], source: EventSource): boolean {
    if (!this.active) {
      return false;
    }

    const at = projectS2LatLng(point);
    this.stroke = {
      inputs: [at[0], at[1]],
      zoom: this.camera.zoom,
      pixel: this.camera.inverseWorldRadius,
    };
    this.redraw();
    return true;
  }

  override drag(point: S2LatLng, source: EventSource): void {
    if (!this.stroke) {
      return;
    }

    const at = projectS2LatLng(point);
    this.stroke.inputs.push(at[0], at[1]);
    this.redraw();
  }

  override dragEnd(point: S2LatLng, moved: boolean, source: EventSource): void {
    const stroke = this.stroke;
    this.clear();
    if (!stroke || !moved) {
      return;
    }

    const at = projectS2LatLng(point);
    stroke.inputs.push(at[0], at[1]);
    const points =
        streamline(stroke.inputs, DEFAULT_MARKER_WIDTH_PX, stroke.pixel, /* complete= */ true);
    const latLngE7 = withoutRepeats(toE7Array(points));
    if (latLngE7.length >= 4) {
      source.trigger(MARKER_DRAWN, {latLngE7, zoom: stroke.zoom});
    }
  }

  // Claimed so that the layers below don't highlight what the pointer crosses.
  override hover(point: S2LatLng, source: EventSource): boolean {
    return this.active;
  }

  override keyPressed(key: string, source: EventSource): boolean {
    if (!this.active || key !== 'Escape') {
      return false;
    }

    if (this.stroke) {
      this.clear();
    } else {
      source.trigger(TOOL_REQUESTED, {tool: 'pointer'});
    }
    return true;
  }

  override render(planner: Planner, zoom: number): void {
    if (this.generation !== this.planned.generation || zoom !== this.planned.zoom) {
      this.plan();
      this.planned = {generation: this.generation, zoom};
    }
    planner.add(this.drawables);
  }

  private clear(): void {
    if (this.stroke) {
      this.stroke = undefined;
      this.redraw();
    }
  }

  private plan(): void {
    const stroke = this.stroke;
    if (!stroke) {
      this.drawables = [];
      return;
    }

    const points =
        streamline(stroke.inputs, DEFAULT_MARKER_WIDTH_PX, stroke.pixel, /* complete= */ false);
    const outline = outlineMarker(points, DEFAULT_MARKER_WIDTH_PX, stroke.pixel);
    this.geometry =
        growBuffer(this.geometry, LineProgram.bytesNeeded(outline.points.length / 2));
    const color = parseColor(DEFAULT_COLOR);
    const result =
        pushMarker(
            color,
            color,
            outline,
            /* extraPx= */ 0,
            this.camera.worldRadius,
            this.geometry,
            /* offset= */ 0);
    if (result.instanceCount === 0) {
      this.drawables = [];
      return;
    }

    this.renderer.uploadData(this.geometry, result.geometryByteLength, this.glGeometry);
    const drawable = {
      elements: undefined,
      geometry: this.glGeometry,
      geometryByteLength: result.geometryByteLength,
      geometryOffset: result.geometryOffset,
      instanced: {count: result.instanceCount},
      program: this.renderer.lineProgram,
      texture: undefined,
      vertexCount: result.vertexCount,
      z: Z_EDITING,
    };
    this.drawables = [drawable];
  }
}

// Points closer together than an E7 unit round onto the same spot.
function withoutRepeats(latLngE7: Int32Array): Int32Array {
  const kept = [];
  for (let i = 0; i < latLngE7.length; i += 2) {
    if (i === 0 || latLngE7[i] !== latLngE7[i - 2] || latLngE7[i + 1] !== latLngE7[i - 1]) {
      kept.push(latLngE7[i], latLngE7[i + 1]);
    }
  }
  return Int32Array.from(kept);
}
