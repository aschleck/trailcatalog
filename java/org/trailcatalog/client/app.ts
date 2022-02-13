// import { S1Angle, S2LatLng, S2LatLngRect, SimpleS2 } from '../s2/SimpleS2';
import { S1Angle, S2LatLng, S2LatLngRect, SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';

class Camera {
  private center: S2LatLng;
  private zoom: number;
  private inverseWorldSize: number;

  constructor() {
    this.center = S2LatLng.fromDegrees(47.644209, -122.139532);
    this.zoom = 17;
    this.inverseWorldSize = 1 / (256 * Math.pow(2, this.zoom));
  }

  viewportBounds(widthPx: number, heightPx: number): S2LatLngRect {
    const dLat = Math.atan(Math.sinh(heightPx * this.inverseWorldSize));
    const dLng = Math.PI * widthPx * this.inverseWorldSize;
    return S2LatLngRect.fromPointPair(
        S2LatLng.fromRadians(this.center.latRadians() - dLat, this.center.lngRadians() - dLng),
        S2LatLng.fromRadians(this.center.latRadians() + dLat, this.center.lngRadians() + dLng));
  }
}

class Renderer {
  private readonly gl: WebGL2RenderingContext;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.gl = this.canvas.getContext('webgl2');
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  render(): void {
    const viewport = new Camera().viewportBounds(this.canvas.width, this.canvas.height);
    const cells = SimpleS2.cover(viewport);
    console.log(cells);
    for (let i = 0; i < cells.size(); ++i) {
      const cell = cells.getAtIndex(i);
      fetch(`/api/fetch_cell/${cell.toToken()}`).then(response => {
        console.log(response);
      });
    }
  }

  resize(): void {
    const area = this.canvas.getBoundingClientRect();
    this.canvas.width = area.width;
    this.canvas.height = area.height;
  }
}

new Renderer(document.getElementById('canvas') as HTMLCanvasElement).render();