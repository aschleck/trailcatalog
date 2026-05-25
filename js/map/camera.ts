import { clamp } from 'external/dev_april_corgi+/js/common/math';

import { S2LatLng, S2LatLngRect, S2Loop } from 'java/org/trailcatalog/s2';
import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';

import { createPerspectiveProjectionMatrix, createViewMatrix, multiply4x4 } from './common/matrix';
import { Rect, Vec2 } from './common/types';

const FOV = Math.PI / 4;
const MAX_EDGE_ANGLE = SimpleS2.earthMetersToAngle(50000).radians();
const MERCATOR_MAX_LAT_RADIANS = 85 / 90 * Math.PI / 2;
const ZOOM_MIN = 4;
const ZOOM_MAX = 22;

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

  get flattenFactor(): number {
    return clamp((this.worldRadius - 65536) / 32768, 0, 1);
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

  sphericalMvp(viewportHeightPx: number, viewportWidthPx: number): Float32Array {
    const lat = this.center.latRadians();
    const lng = this.center.lngRadians();
    const viewportRadiusWorldUnitsAtLat =
      Math.PI * Math.cos(0) * this.inverseWorldRadius * viewportHeightPx / 2;
    const distanceCameraToGlobeSurface = viewportRadiusWorldUnitsAtLat / Math.tan(FOV / 2);
    const scale = 1 + distanceCameraToGlobeSurface;
    const x = scale * Math.cos(lat) * Math.cos(lng);
    const y = scale * Math.sin(lat);
    const z = scale * Math.cos(lat) * Math.sin(lng);
    const viewMatrix = createViewMatrix([x, y, z], [0, 0, 0], [0, -1, 0]);
    const distanceToHorizon = Math.sqrt(scale * scale - 1);
    const projectionMatrix = createPerspectiveProjectionMatrix(
      viewportHeightPx / viewportWidthPx,
      FOV,
      distanceCameraToGlobeSurface * 0.99,
      distanceToHorizon * 1.001);
    const mvpMatrix = new Float32Array(16);
    multiply4x4(/* out= */ mvpMatrix, projectionMatrix, viewMatrix);
    // TODO(josh): Creating this isn't exactly free so we should probably put it somewhere.
    return mvpMatrix;
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
    const mercatorLowLat = Math.asin(Math.tanh((centerPixel[1] - dY) * Math.PI));
    const mercatorHighLat = Math.asin(Math.tanh((centerPixel[1] + dY) * Math.PI));
    const dLng = Math.PI * widthPx * this._inverseWorldRadius / 2;
    const lngC = this._center.lngRadians();

    if (this.flattenFactor >= 1) {
      return S2LatLngRect.fromPointPair(
          S2LatLng.fromRadians(mercatorLowLat, lngC - dLng),
          S2LatLng.fromRadians(mercatorHighLat, lngC + dLng));
    }

    // Spherical: raycast a handful of screen-perimeter points to find what
    // part of the sphere is visible. Falls back to the silhouette point when
    // the ray misses (i.e., that corner of the screen looks at the skybox).
    const latC = this._center.latRadians();
    const cosLatC = Math.cos(latC);
    const sinLatC = Math.sin(latC);
    const cosLngC = Math.cos(lngC);
    const sinLngC = Math.sin(lngC);

    const viewportRadius = Math.PI * heightPx * this._inverseWorldRadius / 2;
    const distance = viewportRadius / Math.tan(FOV / 2);
    const scale = 1 + distance;
    const cosThetaT = 1 / scale;
    const sinThetaT = Math.sqrt(Math.max(0, 1 - cosThetaT * cosThetaT));

    const zAxis: [number, number, number] =
        [cosLatC * cosLngC, sinLatC, cosLatC * sinLngC];
    const xAxis: [number, number, number] = [-sinLngC, 0, cosLngC];
    const yAxis: [number, number, number] =
        [-cosLngC * sinLatC, cosLatC, -sinLngC * sinLatC];
    const eye: [number, number, number] =
        [zAxis[0] * scale, zAxis[1] * scale, zAxis[2] * scale];

    const halfTanFov = Math.tan(FOV / 2);
    const aspect = widthPx / heightPx;

    const samples: ReadonlyArray<readonly [number, number]> = [
      [-1, -1], [0, -1], [1, -1],
      [1, 0], [1, 1], [0, 1],
      [-1, 1], [-1, 0],
    ];

    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLngOff = Infinity;
    let maxLngOff = -Infinity;
    let coversPole = false;

    for (const [sx, sy] of samples) {
      const cx = sx * halfTanFov * aspect;
      const cy = sy * halfTanFov;
      const dx = xAxis[0] * cx + yAxis[0] * cy - zAxis[0];
      const dy = xAxis[1] * cx + yAxis[1] * cy - zAxis[1];
      const dz = xAxis[2] * cx + yAxis[2] * cy - zAxis[2];

      const a = dx * dx + dy * dy + dz * dz;
      const b = 2 * (eye[0] * dx + eye[1] * dy + eye[2] * dz);
      const c = scale * scale - 1;
      const disc = b * b - 4 * a * c;

      let px: number;
      let py: number;
      let pz: number;
      if (disc >= 0) {
        const t = (-b - Math.sqrt(disc)) / (2 * a);
        px = eye[0] + t * dx;
        py = eye[1] + t * dy;
        pz = eye[2] + t * dz;
      } else {
        // Miss: project ray direction onto the plane perpendicular to the
        // camera axis and use the silhouette point in that direction.
        const dn = Math.sqrt(a);
        const ndx = dx / dn;
        const ndy = dy / dn;
        const ndz = dz / dn;
        const dotZ = ndx * zAxis[0] + ndy * zAxis[1] + ndz * zAxis[2];
        let perpX = ndx - dotZ * zAxis[0];
        let perpY = ndy - dotZ * zAxis[1];
        let perpZ = ndz - dotZ * zAxis[2];
        const perpN = Math.sqrt(perpX * perpX + perpY * perpY + perpZ * perpZ);
        perpX /= perpN;
        perpY /= perpN;
        perpZ /= perpN;
        px = cosThetaT * zAxis[0] + sinThetaT * perpX;
        py = cosThetaT * zAxis[1] + sinThetaT * perpY;
        pz = cosThetaT * zAxis[2] + sinThetaT * perpZ;
      }

      const lat = Math.asin(Math.max(-1, Math.min(1, py)));
      const lng = Math.atan2(pz, px);

      if (lat > maxLat) maxLat = lat;
      if (lat < minLat) minLat = lat;

      let dLngFromC = lng - lngC;
      while (dLngFromC > Math.PI) dLngFromC -= 2 * Math.PI;
      while (dLngFromC < -Math.PI) dLngFromC += 2 * Math.PI;
      if (dLngFromC > maxLngOff) maxLngOff = dLngFromC;
      if (dLngFromC < minLngOff) minLngOff = dLngFromC;

      if (Math.abs(py) > 0.999) {
        coversPole = true;
      }
    }

    if (coversPole || sinThetaT >= cosLatC) {
      minLngOff = -Math.PI;
      maxLngOff = Math.PI;
      if (latC >= 0) {
        maxLat = MERCATOR_MAX_LAT_RADIANS;
      } else {
        minLat = -MERCATOR_MAX_LAT_RADIANS;
      }
    }

    return S2LatLngRect.fromPointPair(
        S2LatLng.fromRadians(
            Math.max(
                -MERCATOR_MAX_LAT_RADIANS, Math.min(minLat, mercatorLowLat)),
            lngC + Math.min(minLngOff, -dLng)),
        S2LatLng.fromRadians(
            Math.min(
                MERCATOR_MAX_LAT_RADIANS, Math.max(maxLat, mercatorHighLat)),
            lngC + Math.max(maxLngOff, dLng)));
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

// Returns in the range [-1, 1]
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
  ps.pop(); // We added the first vertex a second time, so pop it off.
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

// Takes x, y in the range [-1, 1]
export function unprojectS2LatLng(x: number, y: number): S2LatLng {
  // If you compare the output of this with EPSG outputs it seems we should multiply latitude with
  // 1.0005718154680088. Yolo
  const lngRadians = Math.PI * x;
  const latRadians = Math.asin(Math.tanh(y * Math.PI));
  return S2LatLng.fromRadians(latRadians, lngRadians);
}

export function projectLatLngRect(rect: S2LatLngRect): Rect {
  return {
    low: projectS2LatLng(rect.lo()),
    high: projectS2LatLng(rect.hi()),
  } as Rect;
}
