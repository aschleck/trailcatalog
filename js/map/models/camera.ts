import { clamp } from 'java/org/trailcatalog/client/common/math';
import { PixelRect, Vec2 } from 'java/org/trailcatalog/client/common/types';
import { S2LatLng, S2LatLngRect, S2Loop } from 'java/org/trailcatalog/s2';
import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';

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

export function projectS2LatLng(ll: S2LatLng): Vec2 {
  const x = ll.lngRadians() / Math.PI;
  const y = Math.log((1 + Math.sin(ll.latRadians())) / (1 - Math.sin(ll.latRadians()))) / (2 * Math.PI);
  return [x, Number.isFinite(y) ? y : 9999 * Math.sign(y)];
}

export function projectS2Loop(loop: S2Loop): Float32Array {
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
  // Project everything
  const vertices = new Float32Array(ps.length * 2 + 2);
  for (let v = 0; v < ps.length; ++v) {
    const projected = projectS2LatLng(SimpleS2.pointToLatLng(ps[v]));
    vertices[v * 2 + 0] = projected[0];
    vertices[v * 2 + 1] = projected[1];
  }
  vertices[ps.length * 2 + 0] = vertices[0];
  vertices[ps.length * 2 + 1] = vertices[1];
  // We can get weird longitude values when part of the edge lies on the antimeridian, fix it
  for (let v = 0; v < ps.length; ++v) {
    const i = v * 2;
    const x = vertices[i + 0];
    const xp = vertices[i + 2];
    if (Math.abs(xp - x) > 1.5) {
      if (xp === -1 || xp === 1) {
        vertices[i + 2] = Math.sign(x);
      } else {
        vertices[i] = Math.sign(xp);
      }
    }
  }
  return vertices;
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
