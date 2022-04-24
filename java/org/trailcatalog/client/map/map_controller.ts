import { Controller, ControllerResponse } from 'js/corgi/controller';

import { checkExists } from '../common/asserts';
import { Vec2 } from '../common/types';
import { MapData, Path, Trail } from './layers/map_data';
import { TileData } from './layers/tile_data';
import { Camera } from './models/camera';
import { Renderer } from './rendering/renderer';
import { RenderPlanner } from './rendering/render_planner';
import { TextRenderer } from './rendering/text_renderer';

import { Debouncer } from './debouncer';
import { MAP_MOVED, PATH_SELECTED, TRAIL_SELECTED } from './events';

interface Args {
  lat: number;
  lng: number;
  zoom: number;
}

interface Response extends ControllerResponse<Args, HTMLDivElement, undefined> {
}

const DPI =
    new URLSearchParams(window.location.search).get('dpi') === 'true'
    ? window.devicePixelRatio ?? 1
    : 1;

export class MapController extends Controller<Args, HTMLDivElement, undefined, Response> {

  static deps() {
    return {
      args: {
        lat: Number,
        lng: Number,
        zoom: Number,
      },
    };
  }

  private readonly camera: Camera;
  private readonly canvas: HTMLCanvasElement;
  private readonly idleDebouncer: Debouncer;
  private readonly renderer: Renderer;
  private readonly renderPlanner: RenderPlanner;

  private readonly mapData: MapData;
  private readonly textRenderer: TextRenderer;
  private readonly tileData: TileData;

  private screenArea: DOMRect;
  private lastMousePosition: Vec2|undefined;
  private lastRenderPlan: number;
  private nextRender: RenderType;

  constructor(response: Response) {
    super(response);
    this.camera = new Camera(response.args.lat, response.args.lng, response.args.zoom);
    this.canvas = checkExists(this.root.querySelector('canvas')) as HTMLCanvasElement;
    this.idleDebouncer = new Debouncer(/* delayMs= */ 100, () => {
      this.enterIdle();
    });
    this.renderer = new Renderer(checkExists(this.canvas.getContext('webgl2')));
    this.renderPlanner = new RenderPlanner([-1, -1], this.renderer);

    this.textRenderer = new TextRenderer(this.renderer);
    this.mapData = new MapData(this.camera, {
      selectedPath: (path: Path) => {
        this.trigger(PATH_SELECTED, {controller: this, path});
      },
      selectedTrail: (trail: Trail) => {
        this.trigger(TRAIL_SELECTED, {controller: this, trail});
      },
    }, this.textRenderer);
    this.tileData = new TileData(this.camera, this.renderer);

    this.screenArea = new DOMRect();
    this.lastRenderPlan = 0;
    this.nextRender = RenderType.CameraChange;

    this.registerListener(window, 'resize', () => this.resize());
    this.resize();

    // We track pointer events on document because it allows us to drag the mouse off-screen while
    // panning.
    const interpreter = new PointerInterpreter(this);
    this.registerListener(document, 'pointerdown', e => {
      if (e.target === this.canvas) {
        interpreter.pointerDown(e);
      }
    });
    // If we started a pan and drag the pointer outside the canvas the target will change, so we
    // don't check it.
    this.registerListener(document, 'pointermove', e => { interpreter.pointerMove(e); });
    this.registerListener(document, 'pointerup', e => { interpreter.pointerUp(e); });
    this.registerListener(this.canvas, 'wheel', e => { this.wheel(e); });

    const raf = () => {
      if (this.isDisposed) {
        return;
      }

      requestAnimationFrame(raf);
      this.render();
    };
    requestAnimationFrame(raf);
  }

  listTrailsInViewport(): Trail[] {
    return this.mapData
        .queryInBounds(
            this.camera.viewportBounds(this.screenArea.width, this.screenArea.height))
        .filter(isTrail);
  }

  setTrailHighlighted(trail: bigint, highlighted: boolean): void {
    return this.mapData.setTrailHighlighted(trail, highlighted);
  }

  click(clientX: number, clientY: number): void {
    const center = this.camera.centerPixel;
    const client = this.screenToRelativeCoord(clientX, clientY);
    const position: Vec2 = [
      center[0] + client[0] * this.camera.inverseWorldRadius,
      center[1] + client[1] * this.camera.inverseWorldRadius,
    ];
    this.mapData.selectClosest(position);
  }

  idle(): void {
    this.idleDebouncer.trigger();
  }

  pan(dx: number, dy: number): void {
    this.camera.translate([dx, dy]);
    this.nextRender = RenderType.CameraChange;
  }

  zoom(amount: number, clientX: number, clientY: number): void {
    this.camera.linearZoom(Math.log2(amount), this.screenToRelativeCoord(clientX, clientY));
    this.nextRender = RenderType.CameraChange;
    this.idleDebouncer.trigger();
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();

    this.camera.linearZoom(-0.01 * e.deltaY, this.screenToRelativeCoord(e.clientX, e.clientY));
    this.nextRender = RenderType.CameraChange;
    this.idleDebouncer.trigger();
  }

  private enterIdle(): void {
    this.nextRender = RenderType.DataChange;
    const size: Vec2 = [this.canvas.width, this.canvas.height];
    for (const layer of [this.mapData, this.tileData]) {
      layer.viewportBoundsChanged(size, this.camera.zoom);
    }

    this.trigger(MAP_MOVED, {
      controller: this,
      center: this.camera.center,
      zoom: this.camera.zoom,
    });
  }

  private screenToRelativeCoord(clientX: number, clientY: number): Vec2 {
    const x = clientX - this.screenArea.x - this.screenArea.width / 2;
    const y = this.screenArea.y + this.screenArea.height / 2 - clientY;
    return [x, y];
  }

  private render(): void {
    if (!this.lastMousePosition) {
      const hasNewData =
          [this.mapData, this.tileData].filter(l => l.hasDataNewerThan(this.lastRenderPlan));
      if (hasNewData.length > 0) {
        this.nextRender = RenderType.DataChange;
      }
    }

    if (this.nextRender >= RenderType.CameraChange) {
      if (this.nextRender >= RenderType.DataChange) {
        this.renderPlanner.clear();
        this.textRenderer.mark();

        const size: Vec2 = [this.canvas.width, this.canvas.height];
        const zoom = this.camera.zoom;
        for (const layer of [this.mapData, this.tileData]) {
          layer.plan(size, zoom, this.renderPlanner);
        }
        this.renderPlanner.save();
        this.textRenderer.sweep();
        this.lastRenderPlan = Date.now();
      }
      this.renderPlanner.render(this.camera);
    }
    this.nextRender = RenderType.NoChange;
  }

  private resize(): void {
    this.screenArea = this.canvas.getBoundingClientRect();
    const width = this.screenArea.width * DPI;
    const height = this.screenArea.height * DPI;
    this.canvas.width = width;
    this.canvas.height = height;
    this.renderPlanner.resize([width, height]);
    this.renderer.resize([width, height]);
    this.nextRender = RenderType.CameraChange;
    this.idleDebouncer.trigger();
  }
}

enum RenderType {
  NoChange = 1,
  CameraChange = 2,
  DataChange = 3,
}

function isTrail(e: Path|Trail): e is Trail {
  return e instanceof Trail;
}

interface PointerListener {
  click(clientX: number, clientY: number): void;
  idle(): void;
  pan(dx: number, dy: number): void;
  zoom(amount: number, clientX: number, clientY: number): void;
}

class PointerInterpreter {

  private readonly pointers: Map<number, PointerEvent>;
  private maybeClickStart: PointerEvent|undefined;

  constructor(private readonly listener: PointerListener) {
    this.pointers = new Map();
    this.maybeClickStart = undefined;
  }

  pointerDown(e: PointerEvent): void {
    e.preventDefault();
    this.pointers.set(e.pointerId, e);

    if (this.pointers.size === 1) {
      this.maybeClickStart = e;
    } else {
      this.maybeClickStart = undefined;
    }
  }

  pointerMove(e: PointerEvent): void {
    if (!this.pointers.has(e.pointerId)) {
      return;
    }

    e.preventDefault();

    if (this.pointers.size === 1) {
      const [last] = this.pointers.values();
      this.listener.pan(last.clientX - e.clientX, -(last.clientY - e.clientY));

      if (this.maybeClickStart) {
        const d2 = distance2(this.maybeClickStart, e);
        if (d2 > 3 * 3) {
          this.maybeClickStart = undefined;
        }
      }
    } else if (this.pointers.size === 2) {
      const [a, b] = this.pointers.values();
      let pivot, handle;
      if (a.pointerId === e.pointerId) {
        pivot = b;
        handle = a;
      } else {
        pivot = a;
        handle = b;
      }

      const was = distance2(pivot, handle);
      const is = distance2(pivot, e);
      this.listener.zoom(
          Math.sqrt(is / was),
          (pivot.clientX + e.clientX) / 2,
          (pivot.clientY + e.clientY) / 2);
    }

    this.pointers.set(e.pointerId, e);
  }

  pointerUp(e: PointerEvent): void {
    if (!this.pointers.has(e.pointerId)) {
      return;
    }

    e.preventDefault();
    this.pointers.delete(e.pointerId);

    if (this.pointers.size === 0) {
      this.listener.idle();

      if (this.maybeClickStart) {
        this.listener.click(this.maybeClickStart.clientX, this.maybeClickStart.clientY);
        this.maybeClickStart = undefined;
      }
    }
  }
}

function distance2(a: PointerEvent, b: PointerEvent): number {
  const x = a.clientX - b.clientX;
  const y = a.clientY - b.clientY;
  return x * x + y * y;
}
