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
import { fitBoundInScreen } from './common/math';
import { createPerspectiveProjectionMatrix } from './common/matrix';
import { Copyright, LatLng, LatLngRect, LatLngZoom, Vec2 } from './common/types';
import { Planner } from './rendering/planner';
import { Renderer } from './rendering/renderer';

import { Camera } from './camera';
import { CopyrightDialog } from './copyright_dialog';
import { CLICKED, DATA_CHANGED, MAP_MOVED, ZOOMED } from './events';
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

  private isIdle: boolean;
  private flingState: Fling|undefined;
  private screenArea: DOMRect;
  private nextRender: RenderType;

  constructor(response: Response<MapController>) {
    super(response);

    // We defer setting real coordinates until after we check our size below
    this.area = [-1, -1];
    this.camera = new Camera(0, 0, -1);
    this.dialog = response.deps.services.dialog;
    this.lastCameraArgs = response.args.camera;
    this.canvas = checkExists(this.root.querySelector('canvas')) as HTMLCanvasElement;
    this.dataChangedDebouncer = new Debouncer(/* delayMs= */ 100, () => {
      this.notifyDataChanged();
    });
    this.idleDebouncer = new Debouncer(/* delayMs= */ 100, () => {
      if (!this.isIdle) {
        // It's okay to return here because we know that we'll get another idleDebouncer when idle()
        // is called by the same interpreter that set us busy.
        return;
      }

      this.enterIdle();
    });
    this.wheelDebouncer = new Debouncer(/* delayMs= */ 100, () => {
      // Yikes! We need to force idle so we re-render even though another pointer thing may have set
      // us non idle.
      this.enterIdle();
    });
    this.renderer =
        new Renderer(checkExists(this.canvas.getContext('webgl2', {
          antialias: false,
          premultipliedAlpha: true,
        })));
    this.registerDisposable(this.renderer);

    this.layers = [];

    this.isIdle = true;
    this.flingState = undefined;
    this.screenArea = new DOMRect();
    this.nextRender = RenderType.CameraChange;

    this.registerListener(window, 'resize', () => this.resize());
    this.resize();
    this.setCamera(response.args.camera ?? {lat: 46.859369, lng: -121.747888, zoom: 12});

    if (response.args.interactive) {
      this.registerInteractiveListeners();
    }

    const raf = () => {
      if (this.isDisposed) {
        return;
      }

      requestAnimationFrame(raf);
      this.advanceFling();
      this.render();
    };
    requestAnimationFrame(raf);
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
    this.enterIdle();
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
    this.layers = layers;
    this.enterIdle();

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
      const fitted = fitBoundInScreen(camera, this.screenArea);
      llz = {
        ...fitted,
        // -0.2 zoom to give a little breathing room
        zoom: fitted.zoom - 0.2,
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
    const offsetX = pageX - this.screenArea.left;
    const offsetY = pageY - this.screenArea.top;
    const ll = this.camera.unprojectScreen(
        offsetX, offsetY, this.screenArea.width, this.screenArea.height);
    // On mobile we don't get hover events, so we won't have previously hovered.
    this.dispatchHover(ll);

    for (const layer of this.layers) {
      if (layer.click(ll, [offsetX, offsetY], contextual, this)) {
        break;
      }
    }
  }

  hover(pageX: number, pageY: number): void {
    const offsetX = pageX - this.screenArea.left;
    const offsetY = pageY - this.screenArea.top;
    const ll = this.camera.unprojectScreen(
        offsetX, offsetY, this.screenArea.width, this.screenArea.height);
    this.dispatchHover(ll);
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

  idle(): void {
    this.enterIdle();
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
    this.nextRender = RenderType.CameraChange;
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
      this.enterIdle();
    }
  }

  // The interpreter skips its idle call when it hands us a fling, so whoever interrupts one owes
  // the layers an idle for the viewport it left us in.
  private stopFling(): void {
    if (!this.flingState) {
      return;
    }

    this.flingState = undefined;
    this.enterIdle();
  }

  zoom(amount: number, pageX: number, pageY: number): void {
    this.isIdle = false;
    this.camera.linearZoom(
        Math.log2(amount),
        [pageX - this.screenArea.left, pageY - this.screenArea.top],
        this.screenArea.width,
        this.screenArea.height);
    this.nextRender = RenderType.CameraChange;
    this.trigger(ZOOMED, {});
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();

    this.camera.linearZoom(
        -0.01 * e.deltaY,
        [e.pageX - this.screenArea.left, e.pageY - this.screenArea.top],
        this.screenArea.width,
        this.screenArea.height);
    this.nextRender = RenderType.CameraChange;
    this.wheelDebouncer.trigger();
    this.trigger(ZOOMED, {});
  }

  private enterIdle(): void {
    this.isIdle = true;
    this.nextRender = RenderType.DataChange;
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

  private notifyDataChanged(): void {
    this.trigger(DATA_CHANGED, {});
  }

  private render(): void {
    const loadingData = this.layers.filter(l => l.loadingData()).length > 0;
    if (loadingData !== this.state.loadingData) {
      this.updateState({
        ...this.state,
        loadingData,
      });
    }

    if (this.isIdle) {
      const hasNewData = this.layers.filter(l => l.hasNewData()).length > 0;
      if (hasNewData) {
        this.dataChangedDebouncer.trigger();
        this.nextRender = RenderType.DataChange;
      }
    }

    if (this.nextRender !== RenderType.NoChange) {
      this.renderer.clear();

      const planner = new Planner();
      for (const layer of this.layers) {
        layer.render(planner, this.camera.zoom);
      }

      const centerPixel = this.camera.centerPixel;
      const mvpMatrix = this.camera.sphericalMvp(this.screenArea.height, this.screenArea.width);
      planner.render(
        this.area,
        this.camera.centerPixel,
        this.camera.flattenFactor,
        mvpMatrix,
        this.camera.worldRadius);

      this.nextRender = RenderType.NoChange;
    }
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
    this.nextRender = RenderType.CameraChange;
    this.enterIdle();
  }
}

enum RenderType {
  NoChange = 1,
  CameraChange = 2,
  DataChange = 3,
}

function isLatLngRect(v: LatLngRect|LatLngZoom): v is LatLngRect {
  return 'brand' in v;
}

