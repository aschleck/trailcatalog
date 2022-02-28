import { S2LatLng, S2LatLngRect } from '../s2';
import { SimpleS2 } from '../s2/SimpleS2';
import { Vec2 } from './models/types';

export class Camera {
  private center: S2LatLng;
  private _inverseWorldRadius: number;
  private _zoom: number;

  constructor() {
    //this.center = S2LatLng.fromDegrees(47.644209, -122.139532);
    //this._zoom = 15;
    this.center = S2LatLng.fromDegrees(46.859369, -121.747888);
    this._zoom = 12;
    this._inverseWorldRadius = 1 / this.worldRadius;
  }

  get centerPixel(): Vec2 {
    return projectLatLng(this.center);
  }

  get inverseWorldRadius(): number {
    return this._inverseWorldRadius;
  }

  get worldRadius(): number {
    return 256 * Math.pow(2, this._zoom - 1);
  }

  get zoom(): number {
    return this._zoom;
  }

  linearZoom(dZ: number, relativePixels: Vec2): void {
    this._zoom += dZ;
    this._inverseWorldRadius = 1 / this.worldRadius;

    const deltaScale = Math.pow(2, dZ);
    const dX = (deltaScale - 1) * relativePixels[0];
    const dY = (deltaScale - 1) * relativePixels[1];

    const centerPixel = projectLatLng(this.center);
    const worldYPixel = centerPixel[1] + dY * this._inverseWorldRadius;
    const newLat = Math.asin(Math.tanh(worldYPixel * Math.PI));
    const dLng = Math.PI * dX * this._inverseWorldRadius;
    this.center = S2LatLng.fromRadians(newLat, this.center.lngRadians() + dLng);
  }

  translate(dPixels: Vec2): void {
    const centerPixel = projectLatLng(this.center);
    const worldYPixel = centerPixel[1] + dPixels[1] * this._inverseWorldRadius;
    const newLat = Math.asin(Math.tanh(worldYPixel * Math.PI));
    const dLng = Math.PI * dPixels[0] * this._inverseWorldRadius;
    this.center = S2LatLng.fromRadians(newLat, this.center.lngRadians() + dLng);
  }

  viewportBounds(widthPx: number, heightPx: number): S2LatLngRect {
    const centerPixel = projectLatLng(this.center);
    const dY = heightPx * this._inverseWorldRadius / 2;
    const lowLat = Math.asin(Math.tanh((centerPixel[1] - dY) * Math.PI));
    const highLat = Math.asin(Math.tanh((centerPixel[1] + dY) * Math.PI));
    const dLng = Math.PI * widthPx * this._inverseWorldRadius / 2;
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

