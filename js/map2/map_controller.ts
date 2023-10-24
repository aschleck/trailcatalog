import { S2LatLngRect } from 'java/org/trailcatalog/s2';
import { checkExists, exists } from 'js/common/asserts';
import { approxEqual } from 'js/common/comparisons';
import { Debouncer } from 'js/common/debouncer';
import { Controller, Response } from 'js/corgi/controller';
import { EmptyDeps } from 'js/corgi/deps';
import { EventSpec } from 'js/corgi/events';

import { DPI } from './common/dpi';
import { fitBoundInScreen } from './common/math';
import { Copyright, LatLng, LatLngRect, LatLngZoom, Vec2 } from './common/types';
import { Planner } from './rendering/planner';
import { Renderer } from './rendering/renderer';

import { Camera, unprojectS2LatLng } from './camera';
import { CLICKED, DATA_CHANGED, MAP_MOVED, ZOOMED } from './events';
import { Layer } from './layer';
import { PointerInterpreter } from './pointer_interpreter';

interface Args {
  camera: LatLngRect|LatLngZoom|undefined;
  interactive: boolean;
}

export interface State {
  copyrights: Copyright[];
  loadingData: boolean;
}

export class MapController extends Controller<Args, EmptyDeps, HTMLDivElement, State> {

  private area: Vec2;
  readonly camera: Camera;
  private lastCameraArgs: LatLngRect|LatLngZoom|undefined;
  private readonly canvas: HTMLCanvasElement;
  private readonly dataChangedDebouncer: Debouncer;
  private readonly idleDebouncer: Debouncer;
  private readonly wheelDebouncer: Debouncer;
  readonly renderer: Renderer;

  private layers: Layer[];

  private isIdle: boolean;
  private screenArea: DOMRect;
  private nextRender: RenderType;

  constructor(response: Response<MapController>) {
    super(response);

    // We defer setting real coordinates until after we check our size below
    this.area = [-1, -1];
    this.camera = new Camera(0, 0, -1);
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
          stencil: true,
        })));
    this.registerDisposable(this.renderer);

    this.layers = [];

    this.isIdle = true;
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
    this.registerListener(this.canvas, 'wheel', e => { this.wheel(e); });
    this.registerListener(this.canvas, 'contextmenu', e => { e.preventDefault(); });
  }

  setLayers(layers: Layer[]): void {
    this.layers.forEach(layer => { layer.dispose(); });
    this.layers = layers;
    this.layers.forEach(layer => {
      this.registerDisposable(layer);
    });
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
    const point = this.clientToWorld(offsetX, offsetY)
    const ll = unprojectS2LatLng(point[0], point[1]);
    // On mobile we don't get hover events, so we won't have previously hovered.
    for (const layer of this.layers) {
      if (layer.hover(ll, this)) {
        break;
      }
    }

    for (const layer of this.layers) {
      if (layer.click(ll, [offsetX, offsetY], contextual, this)) {
        break;
      }
    }
  }

  hover(pageX: number, pageY: number): void {
    const offsetX = pageX - this.screenArea.left;
    const offsetY = pageY - this.screenArea.top;
    const point = this.clientToWorld(offsetX, offsetY);
    const ll = unprojectS2LatLng(point[0], point[1]);
    for (const layer of this.layers) {
      if (layer.hover(ll, this)) {
        break;
      }
    }
  }

  idle(): void {
    this.enterIdle();
  }

  pan(dx: number, dy: number): void {
    this.isIdle = false;
    this.camera.translate([dx, dy]);
    this.nextRender = RenderType.CameraChange;
  }

  zoom(amount: number, pageX: number, pageY: number): void {
    this.isIdle = false;
    const offsetX = pageX - this.screenArea.left;
    const offsetY = pageY - this.screenArea.top;
    this.camera.linearZoom(Math.log2(amount), this.screenToRelativeCoord(offsetX, offsetY));
    this.nextRender = RenderType.CameraChange;
    this.trigger(ZOOMED, {});
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();

    const offsetX = e.pageX - this.screenArea.left;
    const offsetY = e.pageY - this.screenArea.top;
    this.camera.linearZoom(-0.01 * e.deltaY, this.screenToRelativeCoord(offsetX, offsetY));
    this.nextRender = RenderType.CameraChange;
    this.wheelDebouncer.trigger();
    this.trigger(ZOOMED, {});
  }

  private enterIdle(): void {
    this.isIdle = true;
    this.nextRender = RenderType.DataChange;
    // No DPI here because this controls the overdraw for panning
    const bounds = this.camera.viewportBounds(this.canvas.width, this.canvas.height);
    for (const layer of this.layers) {
      layer.viewportChanged(bounds, this.camera.zoom);
    }

    this.trigger(MAP_MOVED, {
      center: this.camera.center,
      zoom: this.camera.zoom,
    });
  }

  private notifyDataChanged(): void {
    this.trigger(DATA_CHANGED, {});
  }

  private clientToWorld(offsetX: number, offsetY: number): Vec2 {
    const center = this.camera.centerPixel;
    const client = this.screenToRelativeCoord(offsetX, offsetY);
    return [
      center[0] + client[0] * this.camera.inverseWorldRadius,
      center[1] + client[1] * this.camera.inverseWorldRadius,
    ];
  }

  private screenToRelativeCoord(offsetX: number, offsetY: number): Vec2 {
    const x = offsetX - this.screenArea.width / 2;
    const y = this.screenArea.height / 2 - offsetY;
    return [x, y];
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
        layer.render(planner);
      }

      const centerPixel = this.camera.centerPixel;
      const centerPixels = [centerPixel];
      // Add extra camera positions for wrapping the world
      //
      // There's some weird normalization bug at
      // lat=42.3389265&lng=177.6919189&zoom=3.020
      // where tiles don't show up around the wrap. Seems like S2 sometimes normalizes and sometimes
      // doesn't depending on the size of the range. So we check the max/min.
      const bounds = this.camera.viewportBounds(this.area[0], this.area[1]);
      if (Math.min(bounds.lng().lo(), bounds.lng().hi()) < -Math.PI) {
        centerPixels.push([centerPixel[0] + 2, centerPixel[1]]);
      }
      if (Math.max(bounds.lng().lo(), bounds.lng().hi()) > Math.PI) {
        centerPixels.push([centerPixel[0] - 2, centerPixel[1]]);
      }

      planner.render(this.area, centerPixels, this.camera.worldRadius);

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

