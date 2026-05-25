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

  linearZoom(dZ: number, cursorOffset: Vec2, widthPx: number, heightPx: number): void {
    const nz = clamp(this._zoom + dZ, ZOOM_MIN, ZOOM_MAX);
    if (this._zoom === nz) {
      return;
    }

    if (this.flattenFactor >= 1) {
      this._zoom = nz;
      this._inverseWorldRadius = 1 / this.worldRadius;

      const deltaScale = Math.pow(2, dZ);
      const relX = cursorOffset[0] - widthPx / 2;
      const relY = heightPx / 2 - cursorOffset[1];
      const dX = (deltaScale - 1) * relX;
      const dY = (deltaScale - 1) * relY;

      const centerPixel = projectS2LatLng(this._center);
      const worldYPixel = centerPixel[1] + dY * this._inverseWorldRadius;
      const newLat = Math.asin(Math.tanh(worldYPixel * Math.PI));
      const dLng = Math.PI * dX * this._inverseWorldRadius;
      this._center = S2LatLng.fromRadians(newLat, this._center.lngRadians() + dLng);
      return;
    }

    // Globe: ray-cast the cursor before and after the zoom and rotate the
    // camera so the pre-zoom sphere point ends up back under the cursor.
    const ndc = screenToNdc(cursorOffset[0], cursorOffset[1], widthPx, heightPx);
    const preFrame = this.sphericalFrame(widthPx, heightPx);
    const before = raycastUnitSphere(ndc, preFrame);

    this._zoom = nz;
    this._inverseWorldRadius = 1 / this.worldRadius;

    const postFrame = this.sphericalFrame(widthPx, heightPx);
    const after = raycastUnitSphere(ndc, postFrame);

    const lat = this._center.latRadians();
    const lng = this._center.lngRadians();
    const center: Vec3 = [
      Math.cos(lat) * Math.cos(lng),
      Math.sin(lat),
      Math.cos(lat) * Math.sin(lng),
    ];
    const rotated = rotateFromTo(center, after, before);
    const newLat = clamp(
        Math.asin(clamp(rotated[1], -1, 1)),
        -MERCATOR_MAX_LAT_RADIANS, MERCATOR_MAX_LAT_RADIANS);
    const newLng = Math.atan2(rotated[2], rotated[0]);
    this._center = S2LatLng.fromRadians(newLat, newLng);
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

  // Pan from `last` to `curr` in canvas-offset pixels. In globe mode this is a
  // trackball rotation that keeps the sphere point under the cursor pinned to
  // the cursor; in mercator mode it's a straight pixel-delta translation.
  pan(last: Vec2, curr: Vec2, widthPx: number, heightPx: number): void {
    if (this.flattenFactor >= 1) {
      this.translate([last[0] - curr[0], curr[1] - last[1]]);
      return;
    }

    const frame = this.sphericalFrame(widthPx, heightPx);
    const p0 = raycastUnitSphere(
        screenToNdc(last[0], last[1], widthPx, heightPx), frame);
    const p1 = raycastUnitSphere(
        screenToNdc(curr[0], curr[1], widthPx, heightPx), frame);

    const lat = this._center.latRadians();
    const lng = this._center.lngRadians();
    const center: Vec3 = [
      Math.cos(lat) * Math.cos(lng),
      Math.sin(lat),
      Math.cos(lat) * Math.sin(lng),
    ];
    const rotated = rotateFromTo(center, p1, p0);

    const newLat = Math.asin(clamp(rotated[1], -1, 1));
    const newLng = Math.atan2(rotated[2], rotated[0]);
    const clampedLat = clamp(newLat, -MERCATOR_MAX_LAT_RADIANS, MERCATOR_MAX_LAT_RADIANS);
    const wrappedLng = (newLng + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
    this._center = S2LatLng.fromRadians(clampedLat, wrappedLng);
  }

  // Convert a canvas-offset pixel to a lat/lng using the actual projection in
  // use (spherical when not fully flattened, mercator otherwise).
  unprojectScreen(offsetX: number, offsetY: number, widthPx: number, heightPx: number): S2LatLng {
    if (this.flattenFactor >= 1) {
      const x = (offsetX - widthPx / 2) * this._inverseWorldRadius + this.centerPixel[0];
      const y = (heightPx / 2 - offsetY) * this._inverseWorldRadius + this.centerPixel[1];
      return unprojectS2LatLng(x, y);
    }
    const frame = this.sphericalFrame(widthPx, heightPx);
    const p = raycastUnitSphere(
        screenToNdc(offsetX, offsetY, widthPx, heightPx), frame);
    return S2LatLng.fromRadians(Math.asin(clamp(p[1], -1, 1)), Math.atan2(p[2], p[0]));
  }

  private sphericalFrame(widthPx: number, heightPx: number): SphericalFrame {
    const lat = this._center.latRadians();
    const lng = this._center.lngRadians();
    const cosLat = Math.cos(lat);
    const sinLat = Math.sin(lat);
    const cosLng = Math.cos(lng);
    const sinLng = Math.sin(lng);

    const viewportRadius = Math.PI * heightPx * this._inverseWorldRadius / 2;
    const distance = viewportRadius / Math.tan(FOV / 2);
    const scale = 1 + distance;

    const zAxis: Vec3 = [cosLat * cosLng, sinLat, cosLat * sinLng];
    const xAxis: Vec3 = [-sinLng, 0, cosLng];
    const yAxis: Vec3 = [-cosLng * sinLat, cosLat, -sinLng * sinLat];
    const eye: Vec3 = [zAxis[0] * scale, zAxis[1] * scale, zAxis[2] * scale];

    return {
      eye,
      scale,
      xAxis,
      yAxis,
      zAxis,
      halfTanFov: Math.tan(FOV / 2),
      aspect: widthPx / heightPx,
    };
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
    const frame = this.sphericalFrame(widthPx, heightPx);
    const cosLatC = Math.cos(this._center.latRadians());
    const cosThetaT = 1 / frame.scale;
    const sinThetaT = Math.sqrt(Math.max(0, 1 - cosThetaT * cosThetaT));

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
      const [px, py, pz] = raycastUnitSphere([sx, sy], frame);
      const lat = Math.asin(clamp(py, -1, 1));
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
      if (this._center.latRadians() >= 0) {
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

type Vec3 = [number, number, number];

interface SphericalFrame {
  eye: Vec3;
  scale: number;
  xAxis: Vec3;
  yAxis: Vec3;
  zAxis: Vec3;
  halfTanFov: number;
  aspect: number;
}

function screenToNdc(offsetX: number, offsetY: number, widthPx: number, heightPx: number): Vec2 {
  return [(offsetX - widthPx / 2) / (widthPx / 2), (heightPx / 2 - offsetY) / (heightPx / 2)];
}

// Cast a ray from the camera through normalized screen coords (sx,sy in [-1,1])
// at the unit sphere. Returns the closer intersection, or the silhouette point
// in the ray's direction when the ray misses.
function raycastUnitSphere(ndc: Vec2, frame: SphericalFrame): Vec3 {
  const {eye, scale, xAxis, yAxis, zAxis, halfTanFov, aspect} = frame;
  const cx = ndc[0] * halfTanFov * aspect;
  const cy = ndc[1] * halfTanFov;
  const dx = xAxis[0] * cx + yAxis[0] * cy - zAxis[0];
  const dy = xAxis[1] * cx + yAxis[1] * cy - zAxis[1];
  const dz = xAxis[2] * cx + yAxis[2] * cy - zAxis[2];

  const a = dx * dx + dy * dy + dz * dz;
  const b = 2 * (eye[0] * dx + eye[1] * dy + eye[2] * dz);
  const c = scale * scale - 1;
  const disc = b * b - 4 * a * c;

  if (disc >= 0) {
    const t = (-b - Math.sqrt(disc)) / (2 * a);
    return [eye[0] + t * dx, eye[1] + t * dy, eye[2] + t * dz];
  }

  const cosThetaT = 1 / scale;
  const sinThetaT = Math.sqrt(Math.max(0, 1 - cosThetaT * cosThetaT));
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
  return [
    cosThetaT * zAxis[0] + sinThetaT * perpX,
    cosThetaT * zAxis[1] + sinThetaT * perpY,
    cosThetaT * zAxis[2] + sinThetaT * perpZ,
  ];
}

// Rotate `v` by the shortest rotation that takes `from` to `to`. All inputs are
// unit vectors.
function rotateFromTo(v: Vec3, from: Vec3, to: Vec3): Vec3 {
  const ax = from[1] * to[2] - from[2] * to[1];
  const ay = from[2] * to[0] - from[0] * to[2];
  const az = from[0] * to[1] - from[1] * to[0];
  const sinAngle = Math.sqrt(ax * ax + ay * ay + az * az);
  if (sinAngle < 1e-9) {
    return v;
  }
  const cosAngle = from[0] * to[0] + from[1] * to[1] + from[2] * to[2];
  const kx = ax / sinAngle;
  const ky = ay / sinAngle;
  const kz = az / sinAngle;
  // Rodrigues' rotation formula
  const dot = kx * v[0] + ky * v[1] + kz * v[2];
  const oneMinusCos = 1 - cosAngle;
  const cx = ky * v[2] - kz * v[1];
  const cy = kz * v[0] - kx * v[2];
  const cz = kx * v[1] - ky * v[0];
  return [
    v[0] * cosAngle + cx * sinAngle + kx * dot * oneMinusCos,
    v[1] * cosAngle + cy * sinAngle + ky * dot * oneMinusCos,
    v[2] * cosAngle + cz * sinAngle + kz * dot * oneMinusCos,
  ];
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
