import { S2LatLngRect } from 'java/org/trailcatalog/s2';
import { checkExists } from 'js/common/asserts';
import { Debouncer } from 'js/common/debouncer';
import { Controller, Response } from 'js/corgi/controller';
import { EmptyDeps } from 'js/corgi/deps';
import { EventSpec } from 'js/corgi/events';

import { DPI } from './common/dpi';
import { screenLlz } from './common/math';
import { LatLng, LatLngRect, LatLngZoom, Vec2 } from './common/types';
import { Camera } from './models/camera';
import { PinRenderer } from './rendering/pin_renderer';
import { Renderer } from './rendering/renderer';
import { RenderPlanner } from './rendering/render_planner';
import { TextRenderer } from './rendering/text_renderer';

import { CLICKED, DATA_CHANGED, MAP_MOVED, ZOOMED } from './events';
import { Layer } from './layer';
import { PointerInterpreter } from './pointer_interpreter';

interface Args {
  camera: LatLngRect|LatLngZoom;
  interactive: boolean;
}

export class MapController extends Controller<Args, EmptyDeps, HTMLDivElement, undefined> {

  readonly camera: Camera;
  private readonly canvas: HTMLCanvasElement;
  private readonly dataChangedDebouncer: Debouncer;
  private readonly idleDebouncer: Debouncer;
  readonly renderer: Renderer;
  private readonly renderPlanner: RenderPlanner;

  private layers: Layer[];
  readonly pinRenderer: PinRenderer;
  readonly textRenderer: TextRenderer;

  private screenArea: DOMRect;
  private lastMousePosition: Vec2|undefined;
  private lastRenderPlan: number;
  private nextRender: RenderType;

  constructor(response: Response<MapController>) {
    super(response);

    // We defer setting real coordinates until after we check our size below
    this.camera = new Camera(0, 0, -1);
    this.canvas = checkExists(this.root.querySelector('canvas')) as HTMLCanvasElement;
    this.dataChangedDebouncer = new Debouncer(/* delayMs= */ 100, () => {
      this.notifyDataChanged();
    });
    this.idleDebouncer = new Debouncer(/* delayMs= */ 100, () => {
      this.enterIdle();
    });
    this.renderer =
        new Renderer(checkExists(this.canvas.getContext('webgl2', {
          antialias: false,
          premultipliedAlpha: true,
          stencil: true,
        })));
    this.renderPlanner = new RenderPlanner([-1, -1], this.renderer);

    this.pinRenderer = new PinRenderer(this.renderer);
    this.textRenderer = new TextRenderer(this.renderer);
    this.layers = [];

    this.screenArea = new DOMRect();
    this.lastRenderPlan = 0;
    this.nextRender = RenderType.CameraChange;

    this.registerListener(window, 'resize', () => this.resize());
    this.resize();
    this.setCamera(response.args.camera);

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
      llz = screenLlz(camera, this.screenArea);
      // -0.2 zoom to give a little breathing room
      llz.zoom -= 0.2;
    } else {
      llz = camera;
    }
    this.camera.set(llz.lat, llz.lng, llz.zoom);
    this.idle();
  }

  click(pageX: number, pageY: number, contextual: boolean): void {
    const offsetX = pageX - this.screenArea.left;
    const offsetY = pageY - this.screenArea.top;
    const point = this.clientToWorld(offsetX, offsetY)
    // On mobile we don't get hover events, so we won't have previously hovered.
    for (const layer of this.layers) {
      if (layer.hover(point, this)) {
        break;
      }
    }

    for (const layer of this.layers) {
      if (layer.click(point, [offsetX, offsetY], contextual, this)) {
        break;
      }
    }
  }

  hover(pageX: number, pageY: number): void {
    const offsetX = pageX - this.screenArea.left;
    const offsetY = pageY - this.screenArea.top;
    const point = this.clientToWorld(offsetX, offsetY);
    for (const layer of this.layers) {
      if (layer.hover(point, this)) {
        break;
      }
    }
  }

  idle(): void {
    this.idleDebouncer.trigger();
  }

  pan(dx: number, dy: number): void {
    this.camera.translate([dx, dy]);
    this.nextRender = RenderType.CameraChange;
  }

  zoom(amount: number, pageX: number, pageY: number): void {
    const offsetX = pageX - this.screenArea.left;
    const offsetY = pageY - this.screenArea.top;
    this.camera.linearZoom(Math.log2(amount), this.screenToRelativeCoord(offsetX, offsetY));
    this.nextRender = RenderType.CameraChange;
    this.idleDebouncer.trigger();
    this.trigger(ZOOMED, {});
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();

    const offsetX = e.pageX - this.screenArea.left;
    const offsetY = e.pageY - this.screenArea.top;
    this.camera.linearZoom(-0.01 * e.deltaY, this.screenToRelativeCoord(offsetX, offsetY));
    this.nextRender = RenderType.CameraChange;
    this.idleDebouncer.trigger();
    this.trigger(ZOOMED, {});
  }

  private enterIdle(): void {
    this.nextRender = RenderType.DataChange;
    // No DPI here because this controls the overdraw for panning
    const size: Vec2 = [this.canvas.width, this.canvas.height];
    for (const layer of this.layers) {
      layer.viewportBoundsChanged(size, this.camera.zoom);
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
    if (!this.lastMousePosition) {
      const hasNewData = this.layers.filter(l => l.hasDataNewerThan(this.lastRenderPlan));
      if (hasNewData.length > 0) {
        this.dataChangedDebouncer.trigger();
        this.nextRender = RenderType.DataChange;
      }
    }

    if (this.nextRender >= RenderType.CameraChange) {
      if (this.nextRender >= RenderType.DataChange) {
        this.renderPlanner.clear();
        this.pinRenderer.mark();

        const size: Vec2 = [this.canvas.width / DPI, this.canvas.height / DPI];
        const zoom = this.camera.zoom;
        for (const layer of this.layers) {
          layer.plan(size, zoom, this.renderPlanner);
        }

        this.renderPlanner.save();
        this.pinRenderer.sweep();
        this.lastRenderPlan = Date.now();
      }
      this.renderPlanner.render(this.camera);
    }
    this.nextRender = RenderType.NoChange;
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
    this.renderPlanner.resize([width, height]);
    this.renderer.resize([width * DPI, height * DPI]);
    this.nextRender = RenderType.CameraChange;
    this.idleDebouncer.trigger();
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
