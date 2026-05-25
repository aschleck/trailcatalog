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

// Iterative pin-solver tunings. Tolerance is in NDC units (1.0 = halfViewport
// in pixels), so 1e-5 is well below a pixel on any reasonable display. Max
// step caps the per-iteration camera delta so Newton can't overshoot through
// the spherical silhouette where the Jacobian becomes ill-conditioned.
const SOLVER_TOLERANCE = 1e-5;
const SOLVER_MAX_ITERATIONS = 8;
const SOLVER_MAX_STEP = 0.1;
// Finite-difference step for the Jacobian. The Jacobian magnitude scales with
// worldRadius, so a fixed step of 1e-5 would produce ~0.85 NDC of perturbation
// at z=20 — way past the linearization regime. 1e-7 keeps the perturbation
// under ~0.01 NDC across the supported zoom range.
const SOLVER_EPS = 1e-7;

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
    // Smoothstep keeps the derivative zero at both endpoints. The worldRadius
    // window is stretched by 1/cos(lat) so that mercator's 1/cos(lat) apparent
    // scale increase at high latitudes is spread over enough actual zoom to
    // read as ordinary zooming rather than a sudden zoom-in. Drift from the
    // wider window is handled by the iterative pin solver in pan/linearZoom.
    const cosLat = Math.max(0.05, Math.abs(Math.cos(this._center.latRadians())));
    const startRadius = 65536;
    const endRadius = 98304 / cosLat;
    const t = clamp((this.worldRadius - startRadius) / (endRadius - startRadius), 0, 1);
    return t * t * (3 - 2 * t);
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

  // Zoom around the cursor. Find the world point the cursor is currently
  // looking at (by inverting the actual blended projection), then solve for
  // the new camera position that keeps that point under the cursor at the
  // new zoom level.
  linearZoom(dZ: number, cursorOffset: Vec2, widthPx: number, heightPx: number): void {
    const nz = clamp(this._zoom + dZ, ZOOM_MIN, ZOOM_MAX);
    if (this._zoom === nz) {
      return;
    }

    const cursorNdc = screenToNdc(cursorOffset[0], cursorOffset[1], widthPx, heightPx);
    const oldLat = this._center.latRadians();
    const oldLng = this._center.lngRadians();
    const oldIwr = this._inverseWorldRadius;
    const oldF = this.flattenFactor;
    const oldMvp = computeSphericalMvp(oldLat, oldLng, oldIwr, widthPx, heightPx);

    const grab = inverseProjectBlended(
        cursorNdc, oldLat, oldLng, oldIwr, widthPx, heightPx, oldF, oldMvp);

    // Move to the new zoom; flattenFactor is recomputed at the (current) lat
    // — close enough as an initial value for the solver.
    this._zoom = nz;
    this._inverseWorldRadius = 1 / this.worldRadius;
    const newIwr = this._inverseWorldRadius;
    const newF = this.flattenFactor;

    const newC = solveCameraForPin(
        grab.lat, grab.lng, cursorNdc, oldLat, oldLng, newIwr, widthPx, heightPx, newF);

    this._center = S2LatLng.fromRadians(
        clamp(newC.lat, -MERCATOR_MAX_LAT_RADIANS, MERCATOR_MAX_LAT_RADIANS),
        wrapPi(newC.lng));
  }

  // Pan from `last` to `curr`. Find the world point under `last` (in the
  // actual blended projection) and solve for the new camera position that
  // lands that point at `curr`.
  pan(last: Vec2, curr: Vec2, widthPx: number, heightPx: number): void {
    const cursorLastNdc = screenToNdc(last[0], last[1], widthPx, heightPx);
    const cursorCurrNdc = screenToNdc(curr[0], curr[1], widthPx, heightPx);
    const oldLat = this._center.latRadians();
    const oldLng = this._center.lngRadians();
    const iwr = this._inverseWorldRadius;
    const f = this.flattenFactor;
    const mvp = computeSphericalMvp(oldLat, oldLng, iwr, widthPx, heightPx);

    const grab = inverseProjectBlended(
        cursorLastNdc, oldLat, oldLng, iwr, widthPx, heightPx, f, mvp);

    const newC = solveCameraForPin(
        grab.lat, grab.lng, cursorCurrNdc, oldLat, oldLng, iwr, widthPx, heightPx, f);

    this._center = S2LatLng.fromRadians(
        clamp(newC.lat, -MERCATOR_MAX_LAT_RADIANS, MERCATOR_MAX_LAT_RADIANS),
        wrapPi(newC.lng));
  }

  sphericalMvp(viewportHeightPx: number, viewportWidthPx: number): Float32Array {
    // TODO(josh): Creating this isn't exactly free so we should probably put it somewhere.
    return computeSphericalMvp(
        this._center.latRadians(), this._center.lngRadians(),
        this._inverseWorldRadius, viewportWidthPx, viewportHeightPx);
  }

  // Convert a canvas-offset pixel to a lat/lng under the blended projection
  // the shaders actually render. Inverts the same forward pipeline used in
  // pan/zoom so click/hover hit-testing matches what the user sees.
  unprojectScreen(offsetX: number, offsetY: number, widthPx: number, heightPx: number): S2LatLng {
    const cursorNdc = screenToNdc(offsetX, offsetY, widthPx, heightPx);
    const lat = this._center.latRadians();
    const lng = this._center.lngRadians();
    const iwr = this._inverseWorldRadius;
    const f = this.flattenFactor;
    const mvp = computeSphericalMvp(lat, lng, iwr, widthPx, heightPx);
    const v = inverseProjectBlended(cursorNdc, lat, lng, iwr, widthPx, heightPx, f, mvp);
    return S2LatLng.fromRadians(v.lat, v.lng);
  }

  // The tile zoom at which we should fetch source tiles. Hedges between
  // two caps:
  //   - horizon cap acos(1/scale): geometric occlusion limit. At low zoom
  //     (scale ≳ 2.6) this is the only thing limiting the visible cap,
  //     and matching tile density to it gives commit 9af3745's coarse
  //     globe-view fetches — few tiles, no 600-tile storm.
  //   - FOV cap (vertical-edge ray hitting the sphere): perspective limit.
  //     At high zoom (scale ≈ 1) this is what's actually rendered, and
  //     matching tile density to it gives mercator-equivalent detail.
  // Pure FOV-cap fetches fine detail but produces a 200+ tile/layer storm
  // at high latitudes where the FOV cap is moderate and wraps around the
  // pole. Pure horizon-cap leaves z=8-9 spherical views upscaled 8× and
  // visibly triangulated. Geometric mean of the two thetas (= arithmetic
  // mean of the two derived zoom values) hedges between the regimes — at
  // low zoom FOV ≈ horizon and the formula is unchanged from the commit,
  // at high zoom we get tz ≈ (_zoom + commit_tz)/2, midway between full
  // detail and globe-coarse.
  tileFetchZoom(widthPx: number, heightPx: number): number {
    const f = this.flattenFactor;
    if (f >= 1) {
      return this._zoom;
    }
    const viewportRadius = Math.PI * heightPx * this._inverseWorldRadius / 2;
    const scale = 1 + viewportRadius / Math.tan(FOV / 2);
    const thetaFov = Math.max(1e-6, visibleCapRadius(scale, 0));
    const thetaHorizon = Math.max(1e-6, Math.acos(Math.min(1, 1 / scale)));
    const thetaSph = Math.sqrt(thetaFov * thetaHorizon);
    const sphTz = Math.log2(Math.PI * heightPx / (256 * thetaSph));
    return (1 - f) * sphTz + f * this._zoom;
  }

  // Returns the visible spherical cap as seen from the camera, suitable for
  // culling tiles that fall entirely outside the visible region. Bound is
  // the diagonal FOV cap (corners reach √(1+aspect²)× further from cap
  // center than top/bottom edges), clamped to the horizon and padded a
  // little so silhouette tiles aren't clipped. Returns undefined in
  // fully-flat mercator mode.
  sphericalCone(widthPx: number, heightPx: number): SphericalCone | undefined {
    if (this.flattenFactor >= 1) {
      return undefined;
    }
    const frame = computeSphericalFrame(
        this._center.latRadians(), this._center.lngRadians(),
        this._inverseWorldRadius, widthPx, heightPx);
    const horizonCap = Math.acos(Math.min(1, 1 / frame.scale));
    const fovCap = visibleCapRadius(frame.scale, widthPx / heightPx);
    const thetaT = Math.min(horizonCap, fovCap * 1.1);
    return {
      camDir: frame.zAxis,
      cosThetaT: Math.cos(thetaT),
    };
  }

  viewportBounds(widthPx: number, heightPx: number): S2LatLngRect {
    const centerPixel = projectS2LatLng(this._center);
    const dY = heightPx * this._inverseWorldRadius / 2;
    const mercatorLowLat = mercYToLat(centerPixel[1] - dY);
    const mercatorHighLat = mercYToLat(centerPixel[1] + dY);
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
    const frame = computeSphericalFrame(
        this._center.latRadians(), this._center.lngRadians(),
        this._inverseWorldRadius, widthPx, heightPx);
    const cosLatC = Math.cos(this._center.latRadians());
    // Use the diagonal FOV cap (clamped to horizon) for the pole-expansion
    // check. At high zoom near the pole the horizon cap reaches the pole
    // while the FOV cone doesn't — using horizon here forces a full-lng
    // bounding rect, which the tile loop then iterates exhaustively even
    // though the cone culls almost everything.
    const horizonCap = Math.acos(Math.min(1, 1 / frame.scale));
    const fovCap = visibleCapRadius(frame.scale, widthPx / heightPx);
    const thetaT = Math.min(horizonCap, fovCap * 1.1);
    const sinThetaT = Math.sin(thetaT);

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

export interface SphericalCone {
  camDir: Vec3;
  cosThetaT: number;
}

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

function wrapPi(a: number): number {
  return (a + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
}

// Mercator-y in [-1, 1] for latitudes within MERCATOR_MAX_LAT_RADIANS.
function latToMercY(lat: number): number {
  const s = Math.sin(lat);
  return Math.log((1 + s) / (1 - s)) / (2 * Math.PI);
}

function mercYToLat(y: number): number {
  return Math.asin(Math.tanh(y * Math.PI));
}

// Angular radius of the visible cap on the unit sphere, looking from a
// camera at distance `scale` from the sphere center. The camera ray that
// grazes the screen along a chosen direction has tangent
//   h = tan(FOV/2) · √(1 + aspect²)
// where `aspect` is the cross-axis ratio (0 for the vertical-edge ray,
// width/height for the diagonal corner ray). That ray hits the sphere at α
// solving sin(α)/(scale - cos(α)) = h; rearranging gives
//   α = asin(h·scale / √(1+h²)) - atan(h).
// When h·scale ≥ √(1+h²) the ray misses the sphere — the FOV cone wraps
// past the silhouette — and the cap is horizon-limited at acos(1/scale).
function visibleCapRadius(scale: number, aspect: number): number {
  const h = Math.tan(FOV / 2) * Math.sqrt(1 + aspect * aspect);
  const denom = Math.sqrt(1 + h * h);
  const r = h * scale / denom;
  if (r >= 1) {
    return Math.acos(Math.min(1, 1 / scale));
  }
  return Math.asin(r) - Math.atan(h);
}

// Build the spherical perspective MVP at the given camera lat/lng/zoom. The
// scale factor places the camera so that a viewport-half-height covers
// `viewportRadius` arc-length on the unit sphere; that's the worldRadius/π
// per-radian convention shared with the mercator projection at lat=0.
function computeSphericalMvp(
    lat: number, lng: number, inverseWorldRadius: number,
    widthPx: number, heightPx: number): Float32Array {
  const viewportRadius = Math.PI * heightPx * inverseWorldRadius / 2;
  const distance = viewportRadius / Math.tan(FOV / 2);
  const scale = 1 + distance;
  const cosLat = Math.cos(lat);
  const sinLat = Math.sin(lat);
  const cosLng = Math.cos(lng);
  const sinLng = Math.sin(lng);
  const eyeX = scale * cosLat * cosLng;
  const eyeY = scale * sinLat;
  const eyeZ = scale * cosLat * sinLng;
  const viewMatrix = createViewMatrix([eyeX, eyeY, eyeZ], [0, 0, 0], [0, -1, 0]);
  const distanceToHorizon = Math.sqrt(scale * scale - 1);
  const projectionMatrix = createPerspectiveProjectionMatrix(
    heightPx / widthPx, FOV, distance * 0.99, distanceToHorizon * 1.001);
  const mvp = new Float32Array(16);
  multiply4x4(/* out= */ mvp, projectionMatrix, viewMatrix);
  return mvp;
}

function computeSphericalFrame(
    lat: number, lng: number, inverseWorldRadius: number,
    widthPx: number, heightPx: number): SphericalFrame {
  const cosLat = Math.cos(lat);
  const sinLat = Math.sin(lat);
  const cosLng = Math.cos(lng);
  const sinLng = Math.sin(lng);

  const viewportRadius = Math.PI * heightPx * inverseWorldRadius / 2;
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

// Forward-project a world point through the same blend the shaders use. The
// GLSL does
//   mercator_clip = vec4((V.merc - C.merc) * worldRadius / halfViewport, -1, 1)
//   spherical_clip = sphericalMvp * V_3d
//   gl_Position = mix(spherical_clip, mercator_clip, f) / mixed.w
// so we mix the clip-space coordinates (not the post-divide NDC) and divide
// once at the end. Mercator's w is 1, spherical's w varies with V's depth.
function projectBlended(
    V_lat: number, V_lng: number,
    C_lat: number, C_lng: number,
    inverseWorldRadius: number,
    widthPx: number, heightPx: number,
    f: number,
    sphericalMvp: Float32Array): Vec2 {
  // Mercator clip (w=1). Longitude wraps so points across the antimeridian
  // still produce a small relativeCenter.
  let mercRelX = (V_lng - C_lng) / Math.PI;
  if (mercRelX > 1) {
    mercRelX -= 2;
  } else if (mercRelX < -1) {
    mercRelX += 2;
  }
  const mercRelY = latToMercY(V_lat) - latToMercY(C_lat);
  const halfWorldSize = 1 / inverseWorldRadius;
  const mercClipX = mercRelX * halfWorldSize * (2 / widthPx);
  const mercClipY = mercRelY * halfWorldSize * (2 / heightPx);

  // Spherical clip via sphericalMvp * V_3d (column-major matrix).
  const cosV = Math.cos(V_lat);
  const V3d_x = cosV * Math.cos(V_lng);
  const V3d_y = Math.sin(V_lat);
  const V3d_z = cosV * Math.sin(V_lng);
  const m = sphericalMvp;
  const sphereClipX = m[0] * V3d_x + m[4] * V3d_y + m[8] * V3d_z + m[12];
  const sphereClipY = m[1] * V3d_x + m[5] * V3d_y + m[9] * V3d_z + m[13];
  const sphereClipW = m[3] * V3d_x + m[7] * V3d_y + m[11] * V3d_z + m[15];

  const mixedX = (1 - f) * sphereClipX + f * mercClipX;
  const mixedY = (1 - f) * sphereClipY + f * mercClipY;
  const mixedW = (1 - f) * sphereClipW + f; // mercator w = 1

  return [mixedX / mixedW, mixedY / mixedW];
}

// Invert the blended projection: find the world point at the cursor in the
// current camera. Spherical raycast is the initial guess (exact at f=0, close
// at small f). Mercator is linear in V so Newton converges in one step at f=1.
function inverseProjectBlended(
    cursorNdc: Vec2,
    C_lat: number, C_lng: number,
    inverseWorldRadius: number,
    widthPx: number, heightPx: number,
    f: number,
    sphericalMvp: Float32Array): { lat: number; lng: number } {
  const frame = computeSphericalFrame(C_lat, C_lng, inverseWorldRadius, widthPx, heightPx);
  const initial = raycastUnitSphere(cursorNdc, frame);
  const [lat, lng] = solveDampedNewton2D(
      (V_lat, V_lng) => projectBlended(
          V_lat, V_lng, C_lat, C_lng, inverseWorldRadius, widthPx, heightPx, f, sphericalMvp),
      cursorNdc,
      Math.asin(clamp(initial[1], -1, 1)),
      Math.atan2(initial[2], initial[0]));
  return { lat, lng };
}

// Solve for the camera position that lands V at targetNdc in the blended
// projection. MVP is rebuilt each iteration since it depends on the camera.
function solveCameraForPin(
    V_lat: number, V_lng: number,
    targetNdc: Vec2,
    C_init_lat: number, C_init_lng: number,
    inverseWorldRadius: number,
    widthPx: number, heightPx: number,
    f: number): { lat: number; lng: number } {
  const [lat, lng] = solveDampedNewton2D(
      (C_lat, C_lng) => projectBlended(
          V_lat, V_lng, C_lat, C_lng, inverseWorldRadius, widthPx, heightPx, f,
          computeSphericalMvp(C_lat, C_lng, inverseWorldRadius, widthPx, heightPx)),
      targetNdc,
      C_init_lat,
      C_init_lng);
  return { lat, lng };
}

// Damped Newton on a 2D vector function. Returns the (x, y) closest to
// `target` after at most SOLVER_MAX_ITERATIONS, or earlier if the residual
// falls below SOLVER_TOLERANCE. Step is capped to SOLVER_MAX_STEP so we
// don't blow past silhouettes where the Jacobian degenerates.
function solveDampedNewton2D(
    fn: (x: number, y: number) => Vec2,
    target: Vec2,
    x0: number, y0: number): [number, number] {
  let x = x0;
  let y = y0;
  for (let i = 0; i < SOLVER_MAX_ITERATIONS; i++) {
    const f0 = fn(x, y);
    const rX = target[0] - f0[0];
    const rY = target[1] - f0[1];
    if (rX * rX + rY * rY < SOLVER_TOLERANCE * SOLVER_TOLERANCE) {
      break;
    }
    const fdx = fn(x + SOLVER_EPS, y);
    const fdy = fn(x, y + SOLVER_EPS);
    const J11 = (fdx[0] - f0[0]) / SOLVER_EPS;
    const J21 = (fdx[1] - f0[1]) / SOLVER_EPS;
    const J12 = (fdy[0] - f0[0]) / SOLVER_EPS;
    const J22 = (fdy[1] - f0[1]) / SOLVER_EPS;
    const det = J11 * J22 - J12 * J21;
    if (Math.abs(det) < 1e-12) {
      break;
    }
    let dx = (J22 * rX - J12 * rY) / det;
    let dy = (J11 * rY - J21 * rX) / det;
    const mag = Math.sqrt(dx * dx + dy * dy);
    if (mag > SOLVER_MAX_STEP) {
      dx *= SOLVER_MAX_STEP / mag;
      dy *= SOLVER_MAX_STEP / mag;
    }
    x += dx;
    y += dy;
  }
  return [x, y];
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

export function projectE7Array(llE7: Int32Array): Float64Array {
  const projected = new Float64Array(llE7.length);
  for (let i = 0; i < llE7.length; i += 2) {
    projected[i] = e7ToRadians(llE7[i + 1]) / Math.PI;
    const y = latToMercY(e7ToRadians(llE7[i]));
    projected[i + 1] = Number.isFinite(y) ? y : 9999 * Math.sign(y);
  }
  return projected;
}

function e7ToRadians(degrees: number): number {
  return Math.PI / 180 / 10_000_000 * degrees;
}

// Returns in the range [-1, 1]
export function projectS2LatLng(ll: S2LatLng): Vec2 {
  const y = latToMercY(ll.latRadians());
  return [ll.lngRadians() / Math.PI, Number.isFinite(y) ? y : 9999 * Math.sign(y)];
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
  return S2LatLng.fromRadians(mercYToLat(y), Math.PI * x);
}

export function projectLatLngRect(rect: S2LatLngRect): Rect {
  return {
    low: projectS2LatLng(rect.lo()),
    high: projectS2LatLng(rect.hi()),
  } as Rect;
}
