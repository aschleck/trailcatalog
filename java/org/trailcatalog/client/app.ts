// import { S1Angle, S2LatLng, S2LatLngRect, SimpleS2 } from '../s2/SimpleS2';
import { Camera } from 'java/org/trailcatalog/client/camera';
import { MapData } from 'java/org/trailcatalog/client/data';
import { Renderer } from 'java/org/trailcatalog/client/renderer';
import { checkExists, Vec2 } from 'java/org/trailcatalog/client/support';
import { S2CellId } from 'java/org/trailcatalog/s2';
import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';

class Controller {

  private readonly camera: Camera;
  private readonly data: MapData;
  private readonly renderer: Renderer;

  private lastMousePosition: Vec2|undefined;
  private nextRender: RenderType;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.camera = new Camera();
    this.data = new MapData();
    this.renderer = new Renderer(checkExists(this.canvas.getContext('webgl2')), [-1, -1]);
    this.nextRender = RenderType.DataChange;

    window.addEventListener('resize', () => this.resize());
    this.resize();

    document.addEventListener('pointerdown', e => {
      this.lastMousePosition = [e.clientX, e.clientY];
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

      this.refetchData();
    });
    document.addEventListener('pointerup', e => {
      this.lastMousePosition = undefined;
    });

    const raf = () => {
      if (this.nextRender >= RenderType.CameraChange) {
        if (this.nextRender >= RenderType.DataChange) {
          this.renderer.plan(this.data.plan(this.cellsInView()));
        }
        this.renderer.render(this.camera);
      }
      this.nextRender = RenderType.NoChange;
      requestAnimationFrame(raf);
    };
    raf();
  }

  private refetchData(): void {
    this.data.fetchCells(this.cellsInView(), () => {
      this.nextRender = RenderType.DataChange;
    });
  }

  private resize(): void {
    const area = this.canvas.getBoundingClientRect();
    this.canvas.width = area.width;
    this.canvas.height = area.height;
    this.renderer.resize([area.width, area.height]);

    this.nextRender = RenderType.DataChange;
    this.refetchData();
  }

  private cellsInView(): S2CellId[] {
    const viewport = this.camera.viewportBounds(this.canvas.width, this.canvas.height);
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

new Controller(document.getElementById('canvas') as HTMLCanvasElement);
