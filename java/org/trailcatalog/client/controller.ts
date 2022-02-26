import { S2CellId } from '../s2';
import { SimpleS2 } from '../s2/SimpleS2';

import { Camera } from './camera';
import { MapData } from './data';
import { Debouncer } from './debouncer';
import { MAX_GEOMETRY_BYTES, Renderer } from './renderer';
import { RenderPlanner } from './render_planner';
import { checkExists, Vec2 } from './support';
import { TileData } from './tiles';

export class Controller {

  private readonly camera: Camera;
  private readonly data: MapData;
  private readonly geometry: ArrayBuffer;
  private readonly idleDebouncer: Debouncer;
  private readonly renderer: Renderer;
  private readonly tiles: TileData;

  private lastMousePosition: Vec2|undefined;
  private lastRenderPlan: number;
  private nextRender: RenderType;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.camera = new Camera();
    this.data = new MapData();
    this.geometry = new ArrayBuffer(MAX_GEOMETRY_BYTES);
    this.idleDebouncer = new Debouncer(/* delayMs= */ 100, () => {
      this.enterIdle();
    });
    this.renderer = new Renderer(checkExists(this.canvas.getContext('webgl2')), [-1, -1]);
    this.tiles = new TileData(this.camera, this.renderer);
    this.lastRenderPlan = 0;
    this.nextRender = RenderType.CameraChange;

    window.addEventListener('resize', () => this.resize());
    this.resize();

    document.addEventListener('pointerdown', e => {
      this.lastMousePosition = [e.clientX, e.clientY];

      const center = this.camera.centerPixel;
      const position: Vec2 = [
        center[0] + (e.clientX - this.canvas.width / 2) * this.camera.inverseWorldRadius,
        center[1] + (this.canvas.height / 2 - e.clientY) * this.camera.inverseWorldRadius,
      ];
      this.data.query(position, 10 * this.camera.inverseWorldRadius);
    });
    document.addEventListener('pointermove', e => {
      if (!this.lastMousePosition) {
        return;
      }

      this.camera.translate([
          this.lastMousePosition[0] - e.clientX,
          -(this.lastMousePosition[1] - e.clientY),
      ]);
      this.lastMousePosition = [e.clientX, e.clientY];
      this.nextRender = RenderType.CameraChange;
    });
    document.addEventListener('pointerup', e => {
      this.lastMousePosition = undefined;
      this.idleDebouncer.trigger();
    });
    this.canvas.addEventListener('wheel', e => {
      e.preventDefault();

      const relativePixels: Vec2 = [
        e.clientX - this.canvas.width / 2,
        this.canvas.height / 2 - e.clientY,
      ];
      this.camera.linearZoom(-0.01 * e.deltaY, relativePixels);
      this.nextRender = RenderType.CameraChange;
      this.idleDebouncer.trigger();
    });

    const raf = () => {
      this.render();
      requestAnimationFrame(raf);
    };
    requestAnimationFrame(raf);
  }

  private enterIdle(): void {
    this.nextRender = RenderType.DataChange;
    this.data.fetchCells(this.cellsInView());
  }

  private render(): void {
    if (!this.lastMousePosition) {
      if (this.data.hasDataNewerThan(this.lastRenderPlan) ||
          this.tiles.hasDataNewerThan(this.lastRenderPlan)) {
        this.nextRender = RenderType.DataChange;
      }
    }

    if (this.nextRender >= RenderType.CameraChange) {
      if (this.nextRender >= RenderType.DataChange) {
        const planner = new RenderPlanner(this.geometry);
        this.tiles.plan([this.canvas.width, this.canvas.height], planner);
        this.data.plan(this.cellsInView(), planner);
        this.renderer.apply(planner);
        this.lastRenderPlan = Date.now();
      }
      this.renderer.render(this.camera);
    }
    this.nextRender = RenderType.NoChange;
  }

  private resize(): void {
    const area = this.canvas.getBoundingClientRect();
    this.canvas.width = area.width;
    this.canvas.height = area.height;
    this.renderer.resize([area.width, area.height]);
    this.nextRender = RenderType.CameraChange;
    this.idleDebouncer.trigger();
  }

  private cellsInView(): S2CellId[] {
    const scale = 1; // 3 ensures no matter how the user pans, they wont run out of data
    const viewport =
        this.camera.viewportBounds(scale * this.canvas.width, scale * this.canvas.height);
    const cellsInArrayList = SimpleS2.cover(viewport);
    const cells = [];
    for (let i = 0; i < cellsInArrayList.size(); ++i) {
      cells.push(cellsInArrayList.getAtIndex(i));
    }
    return cells;
  }
}

enum RenderType {
  NoChange = 1,
  CameraChange = 2,
  DataChange = 3,
}

// TODO: assert little endian
