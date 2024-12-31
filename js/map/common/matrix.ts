

/**
 * Creates a perspective projection matrix.
 *
 * @param aspect - Aspect ratio, typically canvas height / canvas width. (unitless)
 * @param fieldOfView - Vertical field of view in radians. (e.g., Math.PI / 4 for 45 degrees)
 * @param near - Distance to the near clipping plane. (in the same units as your scene, typically world units)
 * @param far - Distance to the far clipping plane. (in the same units as your scene, typically world units)
 * @returns A 4x4 perspective projection matrix as a Float32Array.
 */
export function createPerspectiveProjectionMatrix(
  aspect = 1.0,
  fieldOfView = Math.PI / 4,
  near = 0.1,
  far = 50.0,
): Float32Array {
  const f = 1.0 / Math.tan(fieldOfView / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f * aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, (2 * far * near) * nf, 0
  ]);
}

/**
 * Creates a view matrix.
 *
 * @param cameraPos - The position of the camera in world space.
 * @param target - The position the camera is looking at in world space.
 * @param up - The direction that is considered up.
 * @returns A 4x4 view matrix as a Float32Array.
 */
export function createViewMatrix(
  cameraPos: [number, number, number],
  target: [number, number, number],
  up: [number, number, number]): Float32Array {
  const [cx, cy, cz] = cameraPos;
  const [tx, ty, tz] = target;
  const [ux, uy, uz] = up;

  // Calculate forward (z axis)
  const zx = cx - tx;
  const zy = cy - ty;
  const zz = cz - tz;
  const zLengthInverse = 1 / Math.sqrt(zx * zx + zy * zy + zz * zz);
  const zAxis = [zx * zLengthInverse, zy * zLengthInverse, zz * zLengthInverse];

  // Calculate right (x axis)
  const xx = uy * zz - uz * zy;
  const xy = uz * zx - ux * zz;
  const xz = ux * zy - uy * zx;
  const xLengthInverse = 1 / Math.sqrt(xx * xx + xy * xy + xz * xz);
  const xAxis = [xx * xLengthInverse, xy * xLengthInverse, xz * xLengthInverse];

  // Calculate up (y axis)
  const yAxis = [
    xAxis[1] * zAxis[2] - xAxis[2] * zAxis[1],
    xAxis[2] * zAxis[0] - xAxis[0] * zAxis[2],
    xAxis[0] * zAxis[1] - xAxis[1] * zAxis[0],
  ];

  return new Float32Array([
    xAxis[0], yAxis[0], zAxis[0], 0,
    xAxis[1], yAxis[1], zAxis[1], 0,
    xAxis[2], yAxis[2], zAxis[2], 0,
    -(xAxis[0] * cx + xAxis[1] * cy + xAxis[2] * cz),
    -(yAxis[0] * cx + yAxis[1] * cy + yAxis[2] * cz),
    -(zAxis[0] * cx + zAxis[1] * cy + zAxis[2] * cz),
    1,
  ]);
}

/** Assumes modifying `out` does not affect `a` or `b`. */
export function multiply4x4(out: Float32Array, a: Float32Array, b: Float32Array): void {
  out[0] = b[0] * a[0] + b[1] * a[4] + b[2] * a[8] + b[3] * a[12];
  out[1] = b[0] * a[1] + b[1] * a[5] + b[2] * a[9] + b[3] * a[13];
  out[2] = b[0] * a[2] + b[1] * a[6] + b[2] * a[10] + b[3] * a[14];
  out[3] = b[0] * a[3] + b[1] * a[7] + b[2] * a[11] + b[3] * a[15];

  out[4] = b[4] * a[0] + b[5] * a[4] + b[6] * a[8] + b[7] * a[12];
  out[5] = b[4] * a[1] + b[5] * a[5] + b[6] * a[9] + b[7] * a[13];
  out[6] = b[4] * a[2] + b[5] * a[6] + b[6] * a[10] + b[7] * a[14];
  out[7] = b[4] * a[3] + b[5] * a[7] + b[6] * a[11] + b[7] * a[15];

  out[8] = b[8] * a[0] + b[9] * a[4] + b[10] * a[8] + b[11] * a[12];
  out[9] = b[8] * a[1] + b[9] * a[5] + b[10] * a[9] + b[11] * a[13];
  out[10] = b[8] * a[2] + b[9] * a[6] + b[10] * a[10] + b[11] * a[14];
  out[11] = b[8] * a[3] + b[9] * a[7] + b[10] * a[11] + b[11] * a[15];

  out[12] = b[12] * a[0] + b[13] * a[4] + b[14] * a[8] + b[15] * a[12];
  out[13] = b[12] * a[1] + b[13] * a[5] + b[14] * a[9] + b[15] * a[13];
  out[14] = b[12] * a[2] + b[13] * a[6] + b[14] * a[10] + b[15] * a[14];
  out[15] = b[12] * a[3] + b[13] * a[7] + b[14] * a[11] + b[15] * a[15];
}
