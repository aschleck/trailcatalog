import { Controller as CorgiController } from 'js/corgi/controller';
import { HistoryService } from 'js/corgi/services/history_service';

import { checkExists } from '../common/asserts';
import { Vec2 } from '../common/types';
import { MapData } from './layers/map_data';
import { TileData } from './layers/tile_data';
import { Camera } from './models/camera';
import { Renderer } from './rendering/renderer';
import { RenderPlanner } from './rendering/render_planner';
import { TextRenderer } from './rendering/text_renderer';

import { Debouncer } from './debouncer';

export class Controller extends CorgiController<HTMLCanvasElement> {

  static deps() {
    return {
      services: { history: HistoryService },
    };
  }

  private readonly camera: Camera;
  private readonly idleDebouncer: Debouncer;
  private readonly renderer: Renderer;
  private readonly renderPlanner: RenderPlanner;

  private readonly mapData: MapData;
  private readonly textRenderer: TextRenderer;
  private readonly tileData: TileData;

  private lastMousePosition: Vec2|undefined;
  private lastRenderPlan: number;
  private nextRender: RenderType;

  constructor(root: HTMLCanvasElement) {
    super(root);
    this.camera = new Camera();
    this.idleDebouncer = new Debouncer(/* delayMs= */ 100, () => {
      this.enterIdle();
    });
    this.renderer = new Renderer(checkExists(this.root.getContext('webgl2')));
    this.renderPlanner = new RenderPlanner([-1, -1], this.renderer);

    this.textRenderer = new TextRenderer(this.renderer);
    this.mapData = new MapData(this.camera, this.textRenderer);
    this.tileData = new TileData(this.camera, this.renderer);
    this.lastRenderPlan = 0;
    this.nextRender = RenderType.CameraChange;

    this.registerListener(window, 'resize', () => this.resize());
    this.resize();

    this.registerListener(document, 'pointerdown', e => { this.mouseDown(e); });
    this.registerListener(document, 'pointermove', e => { this.mouseMove(e); });
    this.registerListener(document, 'pointerup', e => { this.mouseUp(e); });
    this.registerListener(this.root, 'wheel', e => { this.wheel(e); });
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

  private mouseDown(e: MouseEvent): void {
    this.lastMousePosition = [e.clientX, e.clientY];

    const center = this.camera.centerPixel;
    const position: Vec2 = [
      center[0] + (e.clientX - this.root.width / 2) * this.camera.inverseWorldRadius,
      center[1] + (this.root.height / 2 - e.clientY) * this.camera.inverseWorldRadius,
    ];
    this.mapData.query(position);
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

    const relativePixels: Vec2 = [
      e.clientX - this.root.width / 2,
      this.root.height / 2 - e.clientY,
    ];
    this.camera.linearZoom(-0.01 * e.deltaY, relativePixels);
    this.nextRender = RenderType.CameraChange;
    this.idleDebouncer.trigger();
  }

  private enterIdle(): void {
    this.nextRender = RenderType.DataChange;
    const size: Vec2 = [this.root.width, this.root.height];
    this.mapData.viewportBoundsChanged(size);
    this.tileData.viewportBoundsChanged(size);
  }

  private render(): void {
    if (!this.lastMousePosition) {
      if (this.mapData.hasDataNewerThan(this.lastRenderPlan) ||
          this.tileData.hasDataNewerThan(this.lastRenderPlan)) {
        this.nextRender = RenderType.DataChange;
      }
    }

    if (this.nextRender >= RenderType.CameraChange) {
      if (this.nextRender >= RenderType.DataChange) {
        this.renderPlanner.clear();
        this.textRenderer.mark();

        const size: Vec2 = [this.root.width, this.root.height];
        const zoom = this.camera.zoom;
        this.tileData.plan(size, this.renderPlanner);
        this.mapData.plan(size, zoom, this.renderPlanner);
        this.renderPlanner.save();
        this.textRenderer.sweep();
        this.lastRenderPlan = Date.now();
      }
      this.renderPlanner.render(this.camera);
    }
    this.nextRender = RenderType.NoChange;
  }

  private resize(): void {
    const area = this.root.getBoundingClientRect();
    this.root.width = area.width;
    this.root.height = area.height;
    this.renderPlanner.resize([area.width, area.height]);
    this.renderer.resize([area.width, area.height]);
    this.nextRender = RenderType.CameraChange;
    this.idleDebouncer.trigger();
  }
}

enum RenderType {
  NoChange = 1,
  CameraChange = 2,
  DataChange = 3,
}

// TODO: assert little endian
