import { S2LatLng, S2LatLngRect } from 'java/org/trailcatalog/s2';
import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';

import { Vec2 } from './support';

export class Camera {
  private center: S2LatLng;
  private _zoom: number;
  private inverseWorldSize: number;

  constructor() {
    this.center = S2LatLng.fromDegrees(47.644209, -122.139532);
    this._zoom = 15;
    //this.center = S2LatLng.fromDegrees(46.859369, -121.747888);
    //this._zoom = 12;
    this.inverseWorldSize = 1 / this.worldSize;
  }

  get centerPixel(): Vec2 {
    return projectLatLng(this.center);
  }

  get worldSize(): number {
    return 256 * Math.pow(2, this._zoom);
  }

  get zoom(): number {
    return this._zoom;
  }

  linearZoom(dZ: number): void {
    this._zoom += dZ;
  }

  translate(dPixels: Vec2): void {
    const centerPixel = projectLatLng(this.center);
    const worldYPixel = centerPixel[1] + dPixels[1] * this.inverseWorldSize * 2;
    const newLat = Math.asin(Math.tanh(worldYPixel * Math.PI));
    const dLng = Math.PI * dPixels[0] * this.inverseWorldSize * 2;
    this.center = S2LatLng.fromRadians(newLat, this.center.lngRadians() + dLng);
  }

  viewportBounds(widthPx: number, heightPx: number): S2LatLngRect {
    const centerPixel = projectLatLng(this.center);
    const dY = heightPx * this.inverseWorldSize;
    const lowLat = Math.asin(Math.tanh((centerPixel[1] - dY) * Math.PI));
    const highLat = Math.asin(Math.tanh((centerPixel[1] + dY) * Math.PI));
    const dLng = Math.PI * widthPx * this.inverseWorldSize;
    return S2LatLngRect.fromPointPair(
        S2LatLng.fromRadians(lowLat, this.center.lngRadians() - dLng),
        S2LatLng.fromRadians(highLat, this.center.lngRadians() + dLng));
  }
}

function projectLatLng(ll: S2LatLng): Vec2 {
  const x = ll.lngRadians() / Math.PI;
  const y = Math.log((1 + Math.sin(ll.latRadians())) / (1 - Math.sin(ll.latRadians()))) / (2 * Math.PI);
  return [x, y];
}

