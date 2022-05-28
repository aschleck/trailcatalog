import { Controller, Response } from 'js/corgi/controller';

import { checkExists } from '../common/asserts';
import { DPI } from '../common/dpi';
import { Vec2 } from '../common/types';
import { MapDataService } from '../data/map_data_service';
import { TileDataService } from '../data/tile_data_service';
import { Path, Trail } from '../models/types';
import { MapData } from './layers/map_data';
import { TileData } from './layers/tile_data';
import { Camera } from './models/camera';
import { Renderer } from './rendering/renderer';
import { RenderPlanner } from './rendering/render_planner';
import { TextRenderer } from './rendering/text_renderer';

import { Debouncer } from './debouncer';
import { DATA_CHANGED, HOVER_CHANGED, MAP_MOVED, SELECTION_CHANGED } from './events';

interface Args {
  camera: {
    lat: number;
    lng: number;
    zoom: number;
  };
  filter: {
    boundary?: number;
  };
}

type Deps = typeof MapController.deps;

export class MapController extends Controller<Args, Deps, HTMLDivElement, undefined> {

  static deps() {
    return {
      services: {
        mapData: MapDataService,
        tileData: TileDataService,
      },
    };
  }

  private readonly camera: Camera;
  private readonly canvas: HTMLCanvasElement;
  private readonly dataChangedDebouncer: Debouncer;
  private readonly idleDebouncer: Debouncer;
  private readonly renderer: Renderer;
  private readonly renderPlanner: RenderPlanner;

  private readonly mapData: MapData;
  private readonly textRenderer: TextRenderer;
  private readonly tileData: TileData;

  private screenArea: DOMRect;
  private lastHoverTarget: Path|Trail|undefined;
  private lastMousePosition: Vec2|undefined;
  private lastRenderPlan: number;
  private nextRender: RenderType;

  constructor(response: Response<MapController>) {
    super(response);
    const cameraArgs = response.args.camera;
    this.camera = new Camera(cameraArgs.lat, cameraArgs.lng, cameraArgs.zoom);
    this.canvas = checkExists(this.root.querySelector('canvas')) as HTMLCanvasElement;
    this.dataChangedDebouncer = new Debouncer(/* delayMs= */ 100, () => {
      this.notifyDataChanged();
    });
    this.idleDebouncer = new Debouncer(/* delayMs= */ 100, () => {
      this.enterIdle();
    });
    this.renderer =
        new Renderer(checkExists(this.canvas.getContext('webgl2', {stencil: true})));
    this.renderPlanner = new RenderPlanner([-1, -1], this.renderer);

    this.textRenderer = new TextRenderer(this.renderer);
    this.mapData =
        new MapData(
            this.camera,
            response.deps.services.mapData,
            response.args.filter,
            this.textRenderer);
    this.tileData =
        new TileData(this.camera, response.deps.services.tileData, this.renderer);
    [this.mapData, this.tileData].forEach(layer => {
      this.registerDisposable(layer);
    });

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
        this.trigger(SELECTION_CHANGED, {
          controller: this,
          selected: undefined,
          clickPx: [e.clientX, e.clientY],
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

    const raf = () => {
      if (this.isDisposed) {
        return;
      }

      requestAnimationFrame(raf);
      this.render();
    };
    requestAnimationFrame(raf);
  }

  getTrail(id: bigint): Trail|undefined {
    return this.mapData.getTrail(id);
  }

  listTrailsInViewport(): Trail[] {
    return this.mapData
        .queryInBounds(
            this.camera.viewportBounds(this.screenArea.width, this.screenArea.height))
        .filter(isTrail);
  }

  listTrailsOnPath(path: Path): Trail[] {
    return this.mapData.listTrailsOnPath(path);
  }

  setHighlighted(trail: Trail, highlighted: boolean): void {
    return this.mapData.setHighlighted(trail, highlighted);
  }

  click(clientX: number, clientY: number): void {
    const point = this.clientToWorld(clientX, clientY)
    const entity = this.mapData.queryClosest(point);
    this.trigger(SELECTION_CHANGED, {
      controller: this,
      selected: entity,
      clickPx: [clientX - this.screenArea.x, clientY - this.screenArea.y],
    });
  }

  hover(clientX: number, clientY: number): void {
    const best = this.mapData.queryClosest(this.clientToWorld(clientX, clientY));
    if (this.lastHoverTarget !== best) {
      if (this.lastHoverTarget) {
        this.mapData.setHighlighted(this.lastHoverTarget, false);
      }
      this.trigger(HOVER_CHANGED, {controller: this, target: best});
    }
    this.lastHoverTarget = best;
    if (best) {
      this.mapData.setHighlighted(best, true);
    }
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

  private notifyDataChanged(): void {
    this.trigger(DATA_CHANGED, {controller: this});
  }

  private clientToWorld(clientX: number, clientY: number): Vec2 {
    const center = this.camera.centerPixel;
    const client = this.screenToRelativeCoord(clientX, clientY);
    return [
      center[0] + client[0] * this.camera.inverseWorldRadius,
      center[1] + client[1] * this.camera.inverseWorldRadius,
    ];
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
        this.dataChangedDebouncer.trigger();
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
    // We reset the size first or else it will taint the BoundingClientRect call.
    this.canvas.width = 0;
    this.canvas.height = 0;
    this.screenArea = checkExists(this.canvas.parentElement).getBoundingClientRect();
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
  hover(clientX: number, clientY: number): void;
  idle(): void;
  pan(dx: number, dy: number): void;
  zoom(amount: number, clientX: number, clientY: number): void;
}

class PointerInterpreter {

  private readonly pointers: Map<number, PointerEvent>;
  private maybeClickStart: PointerEvent|undefined;

  // If the user is panning or zooming, we want to trigger an idle call when they stop.
  private needIdle: boolean;

  constructor(private readonly listener: PointerListener) {
    this.pointers = new Map();
    this.maybeClickStart = undefined;
    this.needIdle = false;
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

  pointerMove(e: PointerEvent, inCanvas: boolean): void {
    if (!this.pointers.has(e.pointerId)) {
      if (inCanvas) {
        this.listener.hover(e.clientX, e.clientY);
      }
      return;
    }

    e.preventDefault();
    this.needIdle = true;

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
      if (this.needIdle) {
        this.listener.idle();
        this.needIdle = false;
      }

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
