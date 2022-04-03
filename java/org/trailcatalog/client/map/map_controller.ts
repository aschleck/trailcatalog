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
import { MAP_MOVED } from './events';

interface Args {
  lat: number;
  lng: number;
  zoom: number;
}

interface Response extends ControllerResponse<Args, HTMLDivElement, undefined> {
}

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
    this.mapData = new MapData(this.camera, this.textRenderer);
    this.tileData = new TileData(this.camera, this.renderer);

    this.screenArea = new DOMRect();
    this.lastRenderPlan = 0;
    this.nextRender = RenderType.CameraChange;

    this.registerListener(window, 'resize', () => this.resize());
    this.resize();

    // We track pointer events on document because it allows us to drag the mouse off-screen while
    // panning.
    this.registerListener(document, 'pointerdown', e => {
      if (e.target === this.canvas) {
        this.mouseDown(e);
      }
    });
    // If we started a pan and drag the pointer outside the canvas the target will change, so we
    // don't check it.
    this.registerListener(document, 'pointermove', e => { this.mouseMove(e); });
    this.registerListener(document, 'pointerup', e => { this.mouseUp(e); });
    this.registerListener(this.canvas, 'wheel', e => { this.wheel(e); });
    //document.addEventListener('touchstart', e => { this.mouseDown(e); });

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

  private mouseDown(e: MouseEvent): void {
    this.lastMousePosition = [e.clientX, e.clientY];

    const center = this.camera.centerPixel;
    const client = this.screenToRelativeCoord(e);
    const position: Vec2 = [
      center[0] + client[0] * this.camera.inverseWorldRadius,
      center[1] + client[1] * this.camera.inverseWorldRadius,
    ];
    this.mapData.selectClosest(position);
  }

  private mouseMove(e: MouseEvent): void {
    if (!this.lastMousePosition) {
      return;
    }

    this.camera.translate([
        this.lastMousePosition[0] - e.clientX,
        -(this.lastMousePosition[1] - e.clientY),
    ]);
    this.lastMousePosition = [e.clientX, e.clientY];
    this.nextRender = RenderType.CameraChange;
  }

  private mouseUp(e: MouseEvent): void {
    this.lastMousePosition = undefined;
    this.idleDebouncer.trigger();
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();

    this.camera.linearZoom(-0.01 * e.deltaY, this.screenToRelativeCoord(e));
    this.nextRender = RenderType.CameraChange;
    this.idleDebouncer.trigger();
  }

  private enterIdle(): void {
    this.nextRender = RenderType.DataChange;
    const size: Vec2 = [this.canvas.width, this.canvas.height];
    for (const layer of [this.mapData, this.tileData]) {
      layer.viewportBoundsChanged(size);
    }

    this.trigger(MAP_MOVED, {
      controller: this,
      center: this.camera.center,
      zoom: this.camera.zoom,
    });
  }

  private screenToRelativeCoord(e: MouseEvent): Vec2 {
    const x = e.clientX - this.screenArea.x - this.screenArea.width / 2;
    const y = this.screenArea.y + this.screenArea.height / 2 - e.clientY;
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
    this.canvas.width = this.screenArea.width;
    this.canvas.height = this.screenArea.height;
    this.renderPlanner.resize([this.screenArea.width, this.screenArea.height]);
    this.renderer.resize([this.screenArea.width, this.screenArea.height]);
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
