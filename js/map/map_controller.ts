import { S2LatLng, S2LatLngRect } from 'java/org/trailcatalog/s2';
import { checkExists, exists } from 'external/dev_april_corgi+/js/common/asserts';
import { HashSet } from 'external/dev_april_corgi+/js/common/collections';
import { approxEqual } from 'external/dev_april_corgi+/js/common/comparisons';
import { Debouncer } from 'external/dev_april_corgi+/js/common/debouncer';
import { Controller, Response } from 'external/dev_april_corgi+/js/corgi/controller';
import { EmptyDeps } from 'external/dev_april_corgi+/js/corgi/deps';
import { EventSpec } from 'external/dev_april_corgi+/js/corgi/events';
import { DialogService } from 'external/dev_april_corgi+/js/emu/dialog';

import { DPI } from './common/dpi';
import { Copyright, LatLng, LatLngRect, LatLngZoom, Vec2 } from './common/types';
import { GLYPHER } from './rendering/glypher';
import { Planner } from './rendering/planner';
import { Renderer } from './rendering/renderer';

import { Camera, projectS2LatLng, unprojectS2LatLng, worldRadiusAt } from './camera';
import { CopyrightDialog } from './copyright_dialog';
import { CLICKED, DATA_CHANGED, MAP_MOVED, UNCLAIMED_CLICKED, ZOOMED } from './events';
import { Layer } from './layer';
import { PointerInterpreter } from './pointer_interpreter';

interface Args {
  camera: LatLngRect|LatLngZoom|undefined;
  interactive: boolean;
}

interface Fling {
  // Where the drag was released, in page pixels. We keep panning from this point instead of
  // walking it along because in globe mode the angle a pixel of pan covers depends on where on
  // the sphere it lands, and the release point is where the velocity was measured.
  anchor: Vec2;
  velocityX: number; // in px/ms
  velocityY: number; // in px/ms
  lastMs: number;
}

// The zoom where the contours and the trails around a point come in at full detail
const POINT_ZOOM = 14;
// Exponential decay so the glide eases out instead of stopping on a frame. Total travel is
// velocity * FLING_DECAY_MS, so a hard 2 px/ms flick carries 500px, about a phone screen and a
// half.
const FLING_DECAY_MS = 250;
// Below 50 px/s the glide reads as stopped, and we want to actually stop so layers start fetching
// the data for where we landed.
const FLING_STOP_SPEED = 0.05; // in px/ms
// Sampling can hand us a velocity no finger produced, and 4000 px/s already carries a full 1000px.
const FLING_MAX_SPEED = 4; // in px/ms
// A hitch in the frame loop shouldn't turn into a jump, so a gap longer than three frames at 60hz
// counts as three frames.
const FLING_MAX_STEP_MS = 50;
// A notch is 3 lines from browsers that scroll by lines and 100 pixels from Chrome, so a notch
// zooms by the same amount either way.
const WHEEL_LINE_PX = 100 / 3;

export interface State {
  copyrights: Copyright[];
  loadingData: boolean;
}

type Deps = typeof MapController.deps;

export class MapController extends Controller<Args, Deps, HTMLDivElement, State> {

  static deps() {
    return {
      services: {
        dialog: DialogService,
      },
    };
  }

  private area: Vec2;
  readonly camera: Camera;
  private readonly dialog: DialogService;
  private lastCameraArgs: LatLngRect|LatLngZoom|undefined;
  private readonly canvas: HTMLCanvasElement;
  private readonly dataChangedDebouncer: Debouncer;
  private readonly idleDebouncer: Debouncer;
  private readonly wheelDebouncer: Debouncer;
  readonly renderer: Renderer;

  private layers: Layer[];
  // The layer that claimed the drag under way
  private dragging: Layer|undefined;

  private isIdle: boolean;
  private flingState: Fling|undefined;
  private frameRequested: boolean;
  // Whether a layer redrew since we last told listeners, which we hold until idle
  private hasNewData: boolean;
  private screenArea: DOMRect;

  constructor(response: Response<MapController>) {
    super(response);

    // We defer setting real coordinates until after we check our size below
    this.area = [-1, -1];
    this.camera = new Camera(0, 0, -1);
    this.dialog = response.deps.services.dialog;
    this.lastCameraArgs = response.args.camera;
    this.canvas = checkExists(this.root.querySelector('canvas')) as HTMLCanvasElement;
    this.dataChangedDebouncer = new Debouncer(/* delayMs= */ 100, () => {
      this.trigger(DATA_CHANGED, {});
    });
    this.idleDebouncer = new Debouncer(/* delayMs= */ 100, () => {
      if (!this.isIdle) {
        // It's okay to return here because we know that we'll get another idleDebouncer when idle()
        // is called by the same interpreter that set us busy.
        return;
      }

      this.idle();
    });
    this.wheelDebouncer = new Debouncer(/* delayMs= */ 100, () => {
      // Yikes! We need to force idle so we re-render even though another pointer thing may have set
      // us non idle.
      this.idle();
    });
    this.renderer =
        new Renderer(checkExists(this.canvas.getContext('webgl2', {
          antialias: false,
          premultipliedAlpha: true,
        })));
    this.registerDisposable(this.renderer);

    this.layers = [];
    this.dragging = undefined;

    this.isIdle = true;
    this.flingState = undefined;
    this.frameRequested = false;
    this.hasNewData = false;
    this.screenArea = new DOMRect();

    // Layers plan nothing for a glyph the atlas lacks, so they need to replan once it arrives.
    this.registerDisposable(GLYPHER.addListener(() => { this.requestFrame(); }));

    // The layout resizes the map without resizing the window, such as when the sidebar under it
    // opens.
    const resizeObserver = new ResizeObserver(() => {
      this.resize();
    });
    resizeObserver.observe(checkExists(this.canvas.parentElement));
    this.registerDisposer(() => {
      resizeObserver.disconnect();
    });
    this.resize();
    this.setCamera(response.args.camera ?? {lat: 46.859369, lng: -121.747888, zoom: 12});

    if (response.args.interactive) {
      this.registerInteractiveListeners();
    }
  }

  // Re-export this so layers can call it
  trigger<D>(spec: EventSpec<D>, detail: D): void {
    super.trigger(spec, detail);
  }

  updateArgs(newArgs: Args): void {
    if (newArgs.camera && newArgs.camera !== this.lastCameraArgs) {
      this.lastCameraArgs = newArgs.camera;
      this.setCamera(newArgs.camera);
    }
    this.idle();
  }

  private registerInteractiveListeners() {
    // We track pointer events on document because it allows us to drag the mouse off-screen while
    // panning.
    const interpreter = new PointerInterpreter(this);
    this.registerListener(document, 'pointerdown', e => {
      if (e.target === this.canvas) {
        // These are somewhat problematic because double-click listeners get confused, but our goal
        // is to steal focus from inputs and close any popups for panning, which is noble. So for
        // now let's fix this up in the double click handlers until it gets too annoying.
        this.canvas.focus();
        this.stopFling();
        this.trigger(CLICKED, {
          clickPx: [e.pageX - this.screenArea.left, e.pageY - this.screenArea.top],
          contextual: e.button === 2,
        });

        interpreter.pointerDown(e);
      }
    });
    // If we started a pan and drag the pointer outside the canvas the target will change, so we
    // don't check it.
    this.registerListener(document, 'pointermove', e => {
      interpreter.pointerMove(e, e.target === this.canvas);
    });
    this.registerListener(document, 'pointerup', e => { interpreter.pointerUp(e); });
    // The pointer moving onto a panel over the map takes it somewhere no layer hears about, so
    // layers drop whatever follows it.
    this.registerListener(this.canvas, 'pointerleave', () => {
      for (const layer of this.layers) {
        layer.hoverLost(this);
      }
    });
    this.registerListener(document, 'pointercancel', e => { interpreter.pointerCancel(e); });
    this.registerListener(this.canvas, 'wheel', e => { this.wheel(e); });
    this.registerListener(this.canvas, 'contextmenu', e => { e.preventDefault(); });
    this.registerListener(this.canvas, 'keydown', e => {
      if (e.defaultPrevented) {
        return;
      }

      for (const layer of this.layers) {
        if (layer.keyPressed(e.key, this)) {
          e.preventDefault();
          break;
        }
      }
    });
  }

  setLayers(layers: Layer[]): void {
    for (const layer of this.layers) {
      layer.setOnRedraw(undefined);
    }
    this.layers = layers;
    for (const layer of layers) {
      layer.setOnRedraw(() => {
        this.hasNewData = true;
        this.requestFrame();
      });
    }
    this.idle();
    this.copyrightsChanged();
  }

  // For a layer whose copyrights depend on its settings
  copyrightsChanged(): void {
    this.updateState({
      ...this.state,
      // TODO(april): deduplicate
      copyrights: this.layers.flatMap(l => l.copyrights).filter(exists),
    });
  }

  get cameraLlz(): LatLngZoom {
    const center = this.camera.center;
    return {
      lat: center.latDegrees(),
      lng: center.lngDegrees(),
      zoom: this.camera.zoom,
    };
  }

  get viewportBounds(): S2LatLngRect {
    return this.camera.viewportBounds(this.screenArea.width, this.screenArea.height);
  }

  setCamera(camera: LatLngRect|LatLngZoom): void {
    this.stopFling();

    let llz;
    if (isLatLngRect(camera)) {
      const [x0, y0] = projectS2LatLng(S2LatLng.fromDegrees(camera.low[0], camera.low[1]));
      const [x1, y1] = projectS2LatLng(S2LatLng.fromDegrees(camera.high[0], camera.high[1]));
      // A low longitude above the high one crosses the antimeridian.
      const dx = x1 >= x0 ? x1 - x0 : x1 - x0 + 2;
      const cx = x0 + dx / 2;
      const center = unprojectS2LatLng(cx > 1 ? cx - 2 : cx, (y0 + y1) / 2);
      const zoom =
          Math.log2(
              Math.min(this.screenArea.width / dx, this.screenArea.height / (y1 - y0))
                  / worldRadiusAt(0));
      llz = {
        lat: center.latDegrees(),
        lng: center.lngDegrees(),
        // A lone point has no extent to fit, so we zoom in until its surroundings are readable.
        // Otherwise -0.2 zoom gives a little breathing room.
        zoom: isFinite(zoom) ? zoom - 0.2 : Math.max(this.camera.zoom, POINT_ZOOM),
      };
    } else {
      llz = camera;
    }

    const current = this.camera.center;
    if (
        !approxEqual(llz.lat, current.latDegrees(), 0.000001)
            || !approxEqual(llz.lng, current.lngDegrees(), 0.000001)
            || !approxEqual(llz.zoom, this.camera.zoom, 0.001)) {
      this.camera.set(llz.lat, llz.lng, llz.zoom);
      this.idle();
    }
  }

  click(pageX: number, pageY: number, contextual: boolean): void {
    const {ll, px} = this.unprojectPage(pageX, pageY);
    // On mobile we don't get hover events, so we won't have previously hovered.
    this.dispatchHover(ll);

    for (const layer of this.layers) {
      if (layer.click(ll, px, contextual, this)) {
        return;
      }
    }
    if (!contextual) {
      this.trigger(UNCLAIMED_CLICKED, {point: ll, px});
    }
  }

  dragStart(pageX: number, pageY: number): boolean {
    const {ll, px} = this.unprojectPage(pageX, pageY);
    for (const layer of this.layers) {
      if (layer.dragStart(ll, px, this)) {
        this.dragging = layer;
        return true;
      }
    }
    return false;
  }

  drag(pageX: number, pageY: number): void {
    this.dragging?.drag(this.unprojectPage(pageX, pageY).ll, this);
  }

  dragEnd(pageX: number, pageY: number, moved: boolean): void {
    const layer = this.dragging;
    this.dragging = undefined;
    layer?.dragEnd(this.unprojectPage(pageX, pageY).ll, moved, this);
  }

  private unprojectPage(pageX: number, pageY: number): {ll: S2LatLng; px: [number, number]} {
    const px: [number, number] = [pageX - this.screenArea.left, pageY - this.screenArea.top];
    const ll =
        this.camera.unprojectScreen(px[0], px[1], this.screenArea.width, this.screenArea.height);
    return {ll, px};
  }

  hover(pageX: number, pageY: number): void {
    this.dispatchHover(this.unprojectPage(pageX, pageY).ll);
  }

  // The layers under the claimant hear hoverLost because a layer only clears its highlight when it
  // is told where the cursor went, and it stops being told once something above it claims.
  private dispatchHover(ll: S2LatLng): void {
    let claimed = false;
    for (const layer of this.layers) {
      if (claimed) {
        layer.hoverLost(this);
      } else {
        claimed = layer.hover(ll, this);
      }
    }
  }

  showCopyrights(): void {
    const unique = [...new HashSet(c => `${c.long}|${c.url}`, this.state.copyrights)];
    unique.sort((a, b) => a.long < b.long ? -1 : a.long === b.long ? 0 : 1);
    this.dialog.display(CopyrightDialog({copyrights: unique}));
  }

  pan(lastPageX: number, lastPageY: number, currPageX: number, currPageY: number): void {
    this.isIdle = false;
    this.camera.pan(
        [lastPageX - this.screenArea.left, lastPageY - this.screenArea.top],
        [currPageX - this.screenArea.left, currPageY - this.screenArea.top],
        this.screenArea.width,
        this.screenArea.height);
    this.requestFrame();
  }

  fling(pageX: number, pageY: number, velocityX: number, velocityY: number): void {
    const speed2 = velocityX * velocityX + velocityY * velocityY;
    const scale =
        speed2 > FLING_MAX_SPEED * FLING_MAX_SPEED
            ? FLING_MAX_SPEED / Math.sqrt(speed2) : 1;
    this.flingState = {
      anchor: [pageX, pageY],
      velocityX: velocityX * scale,
      velocityY: velocityY * scale,
      lastMs: performance.now(),
    };
    this.requestFrame();
  }

  private advanceFling(): void {
    const fling = this.flingState;
    if (!fling) {
      return;
    }

    const now = performance.now();
    const dt = Math.min(now - fling.lastMs, FLING_MAX_STEP_MS);
    fling.lastMs = now;

    this.pan(
        fling.anchor[0],
        fling.anchor[1],
        fling.anchor[0] + fling.velocityX * dt,
        fling.anchor[1] + fling.velocityY * dt);

    const decay = Math.exp(-dt / FLING_DECAY_MS);
    fling.velocityX *= decay;
    fling.velocityY *= decay;

    const speed2 = fling.velocityX * fling.velocityX + fling.velocityY * fling.velocityY;
    if (speed2 < FLING_STOP_SPEED * FLING_STOP_SPEED) {
      this.flingState = undefined;
      this.idle();
    }
  }

  // The interpreter skips its idle call when it hands us a fling, so whoever interrupts one owes
  // the layers an idle for the viewport it left us in.
  private stopFling(): void {
    if (!this.flingState) {
      return;
    }

    this.flingState = undefined;
    this.idle();
  }

  zoom(amount: number, pageX: number, pageY: number): void {
    this.isIdle = false;
    this.camera.linearZoom(
        Math.log2(amount),
        [pageX - this.screenArea.left, pageY - this.screenArea.top],
        this.screenArea.width,
        this.screenArea.height);
    this.requestFrame();
    this.trigger(ZOOMED, {});
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();

    let deltaPx;
    if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) {
      deltaPx = WHEEL_LINE_PX * e.deltaY;
    } else if (e.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
      deltaPx = this.screenArea.height * e.deltaY;
    } else {
      deltaPx = e.deltaY;
    }
    this.camera.linearZoom(
        -0.01 * deltaPx,
        [e.pageX - this.screenArea.left, e.pageY - this.screenArea.top],
        this.screenArea.width,
        this.screenArea.height);
    this.requestFrame();
    this.wheelDebouncer.trigger();
    this.trigger(ZOOMED, {});
  }

  idle(): void {
    this.isIdle = true;
    this.requestFrame();
    // No DPI here because this controls the overdraw for panning
    const bounds = this.camera.viewportBounds(this.canvas.width, this.canvas.height);
    const cone = this.camera.sphericalCone(this.canvas.width, this.canvas.height);
    const fetchZoom = this.camera.tileFetchZoom(this.canvas.width, this.canvas.height);
    for (const layer of this.layers) {
      layer.viewportChanged(bounds, this.camera.zoom, fetchZoom, cone);
    }

    this.trigger(MAP_MOVED, {
      center: this.camera.center,
      zoom: this.camera.zoom,
    });
  }

  private requestFrame(): void {
    if (this.frameRequested || this.isDisposed) {
      return;
    }

    this.frameRequested = true;
    requestAnimationFrame(() => {
      this.frameRequested = false;
      if (this.isDisposed) {
        return;
      }

      this.advanceFling();
      this.render();
    });
  }

  private render(): void {
    const loadingData = this.layers.filter(l => l.loadingData()).length > 0;
    if (loadingData !== this.state.loadingData) {
      this.updateState({
        ...this.state,
        loadingData,
      });
    }

    if (this.isIdle && this.hasNewData) {
      this.hasNewData = false;
      this.dataChangedDebouncer.trigger();
    }

    this.renderer.clear();

    const planner = new Planner();
    const projection = this.camera.screenProjection(this.area[0], this.area[1]);
    for (const layer of this.layers) {
      layer.render(planner, this.camera.zoom, projection);
    }

    const mvpMatrix = this.camera.sphericalMvp(this.screenArea.height, this.screenArea.width);
    planner.render(
      this.area,
      this.camera.centerPixel,
      this.camera.flattenFactor,
      mvpMatrix,
      this.camera.worldRadius);
  }

  private resize(): void {
    // We reset the size first or else it will taint the BoundingClientRect call.
    this.canvas.width = 0;
    this.canvas.height = 0;
    const viewportRect = checkExists(this.canvas.parentElement).getBoundingClientRect();
    this.screenArea =
        new DOMRect(
            viewportRect.left + window.scrollX,
            viewportRect.top + window.scrollY,
            viewportRect.width,
            viewportRect.height);
    const width = this.screenArea.width;
    const height = this.screenArea.height;
    this.canvas.width = width * DPI;
    this.canvas.height = height * DPI;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.area = [width, height];
    this.renderer.resize([width * DPI, height * DPI]);
    this.idle();
  }
}

function isLatLngRect(v: LatLngRect|LatLngZoom): v is LatLngRect {
  return 'brand' in v;
}

