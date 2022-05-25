import { S2LatLng, S2LatLngRect } from 'java/org/trailcatalog/s2';

import { PixelRect, Vec2 } from '../../common/types';

export class Camera {
  private _center: S2LatLng;
  private _inverseWorldRadius: number;
  private _zoom: number;

  constructor(lat: number, lng: number, zoom: number) {
    //this._center = S2LatLng.fromDegrees(47.644209, -122.139532);
    //this._zoom = 15;
    this._center = S2LatLng.fromDegrees(lat, lng);
    this._zoom = zoom;
    this._inverseWorldRadius = 1 / this.worldRadius;
  }

  get center(): S2LatLng {
    return this._center;
  }

  get centerPixel(): Vec2 {
    return projectLatLng(this._center);
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
    this._zoom = clamp(this._zoom + dZ, 2, 19);
    this._inverseWorldRadius = 1 / this.worldRadius;

    const deltaScale = Math.pow(2, dZ);
    const dX = (deltaScale - 1) * relativePixels[0];
    const dY = (deltaScale - 1) * relativePixels[1];

    const centerPixel = projectLatLng(this._center);
    const worldYPixel = centerPixel[1] + dY * this._inverseWorldRadius;
    const newLat = Math.asin(Math.tanh(worldYPixel * Math.PI));
    const dLng = Math.PI * dX * this._inverseWorldRadius;
    this._center = S2LatLng.fromRadians(newLat, this._center.lngRadians() + dLng);
  }

  translate(dPixels: Vec2): void {
    const centerPixel = projectLatLng(this._center);
    const worldYPixel = centerPixel[1] + dPixels[1] * this._inverseWorldRadius;
    const newLat = Math.asin(Math.tanh(worldYPixel * Math.PI));
    const dLng = Math.PI * dPixels[0] * this._inverseWorldRadius;
    this._center = S2LatLng.fromRadians(newLat, this._center.lngRadians() + dLng);
  }

  viewportBounds(widthPx: number, heightPx: number): S2LatLngRect {
    const centerPixel = projectLatLng(this._center);
    const dY = heightPx * this._inverseWorldRadius / 2;
    const lowLat = Math.asin(Math.tanh((centerPixel[1] - dY) * Math.PI));
    const highLat = Math.asin(Math.tanh((centerPixel[1] + dY) * Math.PI));
    const dLng = Math.PI * widthPx * this._inverseWorldRadius / 2;
    return S2LatLngRect.fromPointPair(
        S2LatLng.fromRadians(lowLat, this._center.lngRadians() - dLng),
        S2LatLng.fromRadians(highLat, this._center.lngRadians() + dLng));
  }
}

function clamp(x: number, min: number, max: number): number {
  if (x < min) {
    return min;
  } else if (x > max) {
    return max;
  } else {
    return x;
  }
}

function projectLatLng(ll: S2LatLng): Vec2 {
  const x = ll.lngRadians() / Math.PI;
  const y = Math.log((1 + Math.sin(ll.latRadians())) / (1 - Math.sin(ll.latRadians()))) / (2 * Math.PI);
  return [x, y];
}

export function projectLatLngRect(rect: S2LatLngRect): PixelRect {
  return {
    low: projectLatLng(rect.lo()),
    high: projectLatLng(rect.hi()),
  };
}
