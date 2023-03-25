import { S2LatLng, S2LatLngRect, S2Loop } from 'java/org/trailcatalog/s2';
import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';
import { clamp } from 'js/common/math';

import { PixelRect, Vec2 } from '../common/types';

const MAX_EDGE_ANGLE = SimpleS2.earthMetersToAngle(50000).radians();
const MERCATOR_MAX_LAT_RADIANS = 85 / 90 * Math.PI / 2;
const ZOOM_MIN = 3; // we don't have tiles below 3
const ZOOM_MAX = 19;

export class Camera {
  private _center: S2LatLng;
  private _inverseWorldRadius: number;
  private _zoom: number;

  constructor(lat: number, lng: number, zoom: number) {
    this._center = S2LatLng.fromDegrees(lat, lng);
    this._zoom = isFinite(zoom) ? clamp(zoom, ZOOM_MIN, ZOOM_MAX) : ZOOM_MIN;
    this._inverseWorldRadius = 1 / this.worldRadius;
  }

  get center(): S2LatLng {
    return this._center;
  }

  get centerPixel(): Vec2 {
    return projectS2LatLng(this._center);
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

  set(lat: number, lng: number, zoom: number): void {
    this._center = S2LatLng.fromDegrees(lat, lng);
    this._zoom = isFinite(zoom) ? clamp(zoom, ZOOM_MIN, ZOOM_MAX) : ZOOM_MIN;
    this._inverseWorldRadius = 1 / this.worldRadius;
  }

  linearZoom(dZ: number, relativePixels: Vec2): void {
    const nz = clamp(this._zoom + dZ, ZOOM_MIN, ZOOM_MAX);
    if (this._zoom === nz) {
      return;
    }

    this._zoom = nz;
    this._inverseWorldRadius = 1 / this.worldRadius;

    const deltaScale = Math.pow(2, dZ);
    const dX = (deltaScale - 1) * relativePixels[0];
    const dY = (deltaScale - 1) * relativePixels[1];

    const centerPixel = projectS2LatLng(this._center);
    const worldYPixel = centerPixel[1] + dY * this._inverseWorldRadius;
    const newLat = Math.asin(Math.tanh(worldYPixel * Math.PI));
    const dLng = Math.PI * dX * this._inverseWorldRadius;
    this._center = S2LatLng.fromRadians(newLat, this._center.lngRadians() + dLng);
  }

  translate(dPixels: Vec2): void {
    const centerPixel = projectS2LatLng(this._center);
    const worldYPixel = centerPixel[1] + dPixels[1] * this._inverseWorldRadius;
    const newLat = Math.asin(Math.tanh(worldYPixel * Math.PI));
    const clampedNewLat = clamp(newLat, -MERCATOR_MAX_LAT_RADIANS, MERCATOR_MAX_LAT_RADIANS);
    const dLng = Math.PI * dPixels[0] * this._inverseWorldRadius;
    const newLng = this._center.lngRadians() + dLng;
    const wrappedNewLng = (newLng + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
    this._center = S2LatLng.fromRadians(clampedNewLat, wrappedNewLng);
  }

  viewportBounds(widthPx: number, heightPx: number): S2LatLngRect {
    const centerPixel = projectS2LatLng(this._center);
    const dY = heightPx * this._inverseWorldRadius / 2;
    const lowLat = Math.asin(Math.tanh((centerPixel[1] - dY) * Math.PI));
    const highLat = Math.asin(Math.tanh((centerPixel[1] + dY) * Math.PI));
    const dLng = Math.PI * widthPx * this._inverseWorldRadius / 2;
    return S2LatLngRect.fromPointPair(
        S2LatLng.fromRadians(lowLat, this._center.lngRadians() - dLng),
        S2LatLng.fromRadians(highLat, this._center.lngRadians() + dLng));
  }
}

export function projectE7Array(llE7: Int32Array): Float64Array {
  const projected = new Float64Array(llE7.length);
  for (let i = 0; i < llE7.length; i += 2) {
    projected[i] = e7ToRadians(llE7[i + 1]) / Math.PI;
    const lat = e7ToRadians(llE7[i]);
    const y = Math.log((1 + Math.sin(lat)) / (1 - Math.sin(lat))) / (2 * Math.PI);
    projected[i + 1] = Number.isFinite(y) ? y : 9999 * Math.sign(y);
  }
  return projected;
}

function e7ToRadians(degrees: number): number {
  return Math.PI / 180 / 10_000_000 * degrees;
}

export function projectS2LatLng(ll: S2LatLng): Vec2 {
  const x = ll.lngRadians() / Math.PI;
  const y = Math.log((1 + Math.sin(ll.latRadians())) / (1 - Math.sin(ll.latRadians()))) / (2 * Math.PI);
  return [x, Number.isFinite(y) ? y : 9999 * Math.sign(y)];
}

export function projectS2Loop(loop: S2Loop): {splits: number[]; vertices: Float32Array;} {
  const vertexCount = loop.numVertices();
  const ps = [];
  let prev = loop.vertex(0);
  // Since vertices are on the sphere, over MAX_EDGE_ANGLE the curve is lost. So interpolate the
  // vertices to keep accuracy.
  for (let v = 0; v < vertexCount + 1; ++v) {
    const next = loop.vertex(v % vertexCount);
    let length = prev.angle(next);
    while (length > MAX_EDGE_ANGLE) {
      const f = Math.sin(MAX_EDGE_ANGLE) / Math.sin(length);
      prev = prev.mul(Math.cos(MAX_EDGE_ANGLE) - f * Math.cos(length)).add(next.mul(f))
      ps.push(prev);
      length = prev.angle(next);
    }
    ps.push(next);
    prev = next;
  }
  // Project everything, duplicating vertices when we cross meridian and tracking splits
  const projected = [projectS2LatLng(SimpleS2.pointToLatLng(ps[0]))];
  const splits = [];
  let pp = projected[0];
  for (let v = 1; v < ps.length; ++v) {
    const next = projectS2LatLng(SimpleS2.pointToLatLng(ps[v]));
    if (Math.abs(next[0] - pp[0]) > 1.5) {
      if (pp[0] === -1 || pp[0] === 1) {
        splits.push(projected.length * 2);
        projected.push([-pp[0], pp[1]]);
      } else {
        projected.push([-next[0], next[1]]);
        splits.push(projected.length * 2);
      }
    }
    projected.push(next);
    pp = next;
  }
  splits.push(projected.length * 2);
  // Write out all the vertices
  const vertices = new Float32Array(projected.length * 2);
  for (let i = 0; i < projected.length; ++i) {
    const point = projected[i];
    vertices[i * 2 + 0] = point[0];
    vertices[i * 2 + 1] = point[1];
  }
  return {
    splits,
    vertices,
  };
}

export function unprojectS2LatLng(x: number, y: number): S2LatLng {
  const lngRadians = Math.PI * x;
  const latRadians = Math.asin(Math.tanh(y * Math.PI));
  return S2LatLng.fromRadians(latRadians, lngRadians);
}

export function projectLatLngRect(rect: S2LatLngRect): PixelRect {
  return {
    low: projectS2LatLng(rect.lo()),
    high: projectS2LatLng(rect.hi()),
  } as PixelRect;
}
