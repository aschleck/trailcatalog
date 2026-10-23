import { checkExists } from 'external/dev_april_corgi+/js/common/asserts';

import { RgbaU32 } from '../common/types';

import {
  COLOR_OPERATIONS,
  Drawable,
  FP64_OPERATIONS,
  Program,
  ProgramData,
  SPHERE_OPERATIONS,
} from './program';

// We write the pattern with 4 bytes to keep the 32bit numbers aligned.
export const VERTEX_STRIDE =
    4 * (
        2 + 2
            + /* fill= */ 1
            + /* stroke= */ 1
            + /* distanceAlong= */ 1
            + /* radius= */ 1
            + /* pattern= */ 1
    );

/**
 * How a line breaks up along its length. Ticks cross it with a bar every so often like a lift's
 * pylons, alternating dashes it with the fill and stroke colors instead of leaving gaps, and dots
 * are discs as wide as the line.
 */
export type LinePattern =
    'alternating'|'dashed'|'dotted'|'fine_dotted'|'short_dashed'|'solid'|'ticks';

export const LINE_PATTERNS: LinePattern[] =
    ['alternating', 'dashed', 'dotted', 'fine_dotted', 'short_dashed', 'solid', 'ticks'];

// The pattern attribute: the shader's mode in bits 0 to 2, the period in pixels in bits 8 to 15,
// and the share of each period a dash covers, out of 255, in bits 16 to 23. Zero period or share
// is the mode's default.
const PATTERN_CODES: {[pattern in LinePattern]: number} = {
  solid: 0,
  dashed: 1,
  ticks: 2,
  alternating: 3,
  dotted: 4 | (9 << 8),
  fine_dotted: 4 | (5 << 8),
  short_dashed: 1 | (4 << 8),
};

/** Renders instanced line segments as capsules, so joins and ends come out round. */
export class LineProgram extends Program<LineProgramData> {

  /**
   * Bytes that {@link push} (and therefore {@link plan}) will write into the
   * supplied buffer for a polyline of the given vertex count. A polyline of N
   * vertices produces N - 1 segments.
   */
  static bytesNeeded(vertexCount: number): number {
    return Math.max(0, vertexCount - 1) * VERTEX_STRIDE;
  }

  static push(
      colorFill: RgbaU32,
      colorStroke: RgbaU32,
      // One for every segment, or one per segment
      radius: number|ArrayLike<number>,
      pattern: LinePattern,
      points: ArrayLike<number>,
      buffer: ArrayBuffer,
      offset: number,
  ): {
    geometryByteLength: number;
    geometryOffset: number;
    instanceCount: number;
    vertexCount: number;
  } {
    const floats = new Float32Array(buffer, offset);
    // Values that may represent NaN floats (colors) cannot be written as floats due to NaN
    // canonicalization. So we have to write them as uints to the same buffer.
    const uint32s = new Uint32Array(buffer, offset);

    let vertexOffset = 0;
    const stride = VERTEX_STRIDE / 4;
    let distanceAlong = 0;
    for (let i = 0; i < points.length - 2; i += 2) {
      const x = points[i + 0];
      const y = points[i + 1];
      const xp = points[i + 2];
      const yp = points[i + 3];
      floats[vertexOffset + 0] = x;
      floats[vertexOffset + 1] = y;
      floats[vertexOffset + 2] = xp;
      floats[vertexOffset + 3] = yp;

      uint32s[vertexOffset + 4] = colorFill;
      uint32s[vertexOffset + 5] = colorStroke;
      floats[vertexOffset + 6] = distanceAlong;
      floats[vertexOffset + 7] = typeof radius === 'number' ? radius : radius[i / 2];
      uint32s[vertexOffset + 8] = PATTERN_CODES[pattern];

      distanceAlong += Math.sqrt((xp - x) * (xp - x) + (yp - y) * (yp - y));
      vertexOffset += stride;
    }

    return {
      geometryByteLength: vertexOffset * 4,
      geometryOffset: offset,
      instanceCount: vertexOffset / stride,
      vertexCount: 4,
    };
  }

  private readonly lineBuffer: WebGLBuffer;

  constructor(gl: WebGL2RenderingContext) {
    super(createLineProgram(gl), gl, gl.TRIANGLE_STRIP);

    this.lineBuffer = checkExists(gl.createBuffer());
    gl.bindBuffer(gl.COPY_WRITE_BUFFER, this.lineBuffer);
    const square =
        new Float32Array([
          0, 1,
          0, -1,
          1, 1,
          1, -1,
        ]);
    gl.bufferData(gl.COPY_WRITE_BUFFER, square, gl.STATIC_DRAW);
    gl.bindBuffer(gl.COPY_WRITE_BUFFER, null);
    this.registerDisposer(() => {
      gl.deleteBuffer(this.lineBuffer);
    });
  }

  plan(
      colorFill: RgbaU32,
      colorStroke: RgbaU32,
      radius: number,
      pattern: LinePattern,
      z: number,
      points: ArrayLike<number>,
      buffer: ArrayBuffer,
      offset: number,
      glBuffer: WebGLBuffer,
  ): Drawable {
    const result =
        LineProgram.push(colorFill, colorStroke, radius, pattern, points, buffer, offset);

    return {
      elements: undefined,
      geometry: glBuffer,
      geometryByteLength: result.geometryByteLength,
      geometryOffset: result.geometryOffset,
      instanced: {
        count: result.instanceCount,
      },
      program: this,
      texture: undefined,
      vertexCount: result.vertexCount,
      z,
    };
  }

  protected activate(): void {
    const gl = this.gl;

    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuffer);
    gl.enableVertexAttribArray(this.program.attributes.position);
    gl.vertexAttribPointer(
        this.program.attributes.position,
        2,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ 0,
        /* offset= */ 0);

    gl.enableVertexAttribArray(this.program.attributes.colorFill);
    gl.vertexAttribDivisor(this.program.attributes.colorFill, 1);
    gl.enableVertexAttribArray(this.program.attributes.colorStroke);
    gl.vertexAttribDivisor(this.program.attributes.colorStroke, 1);
    gl.enableVertexAttribArray(this.program.attributes.previous);
    gl.vertexAttribDivisor(this.program.attributes.previous, 1);
    gl.enableVertexAttribArray(this.program.attributes.next);
    gl.vertexAttribDivisor(this.program.attributes.next, 1);
    gl.enableVertexAttribArray(this.program.attributes.distanceAlong);
    gl.vertexAttribDivisor(this.program.attributes.distanceAlong, 1);
    gl.enableVertexAttribArray(this.program.attributes.radius);
    gl.vertexAttribDivisor(this.program.attributes.radius, 1);
    gl.enableVertexAttribArray(this.program.attributes.pattern);
    gl.vertexAttribDivisor(this.program.attributes.pattern, 1);
  }

  protected override bindAttributes(offset: number): void {
    const gl = this.gl;

    gl.vertexAttribPointer(
        this.program.attributes.previous,
        2,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ VERTEX_STRIDE,
        /* offset= */ offset + 0);
    gl.vertexAttribPointer(
        this.program.attributes.next,
        2,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ VERTEX_STRIDE,
        /* offset= */ offset + 8);
    gl.vertexAttribPointer(
        this.program.attributes.colorFill,
        1,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ VERTEX_STRIDE,
        /* offset= */ offset + 16);
    gl.vertexAttribPointer(
        this.program.attributes.colorStroke,
        1,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ VERTEX_STRIDE,
        /* offset= */ offset + 20);
    gl.vertexAttribPointer(
        this.program.attributes.distanceAlong,
        1,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ VERTEX_STRIDE,
        /* offset= */ offset + 24);
    gl.vertexAttribPointer(
        this.program.attributes.radius,
        1,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ VERTEX_STRIDE,
        /* offset= */ offset + 28);
    gl.vertexAttribIPointer(
        this.program.attributes.pattern,
        1,
        gl.UNSIGNED_INT,
        /* stride= */ VERTEX_STRIDE,
        /* offset= */ offset + 32);
  }

  protected draw(drawable: Drawable): void {
    if (!drawable.vertexCount || !drawable.instanced) {
      throw new Error('Expecting instances');
    }

    const gl = this.gl;
    this.bindAttributes(drawable.geometryOffset);

    // Draw without the border
    gl.uniform1i(this.program.uniforms.renderBorder, 0);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, drawable.vertexCount, drawable.instanced.count);

    // Lower the z slightly so we draw under fill
    gl.uniform1f(this.program.uniforms.z, (drawable.z - 0.1) / 1000);
    gl.uniform1i(this.program.uniforms.renderBorder, 1);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, drawable.vertexCount, drawable.instanced.count);
    gl.uniform1f(this.program.uniforms.z, drawable.z / 1000);
  }

  protected deactivate(): void {
    const gl = this.gl;

    gl.disableVertexAttribArray(this.program.attributes.position);

    gl.vertexAttribDivisor(this.program.attributes.colorFill, 0);
    gl.disableVertexAttribArray(this.program.attributes.colorFill);
    gl.vertexAttribDivisor(this.program.attributes.colorStroke, 0);
    gl.disableVertexAttribArray(this.program.attributes.colorStroke);
    gl.vertexAttribDivisor(this.program.attributes.previous, 0);
    gl.disableVertexAttribArray(this.program.attributes.previous);
    gl.vertexAttribDivisor(this.program.attributes.next, 0);
    gl.disableVertexAttribArray(this.program.attributes.next);
    gl.vertexAttribDivisor(this.program.attributes.distanceAlong, 0);
    gl.disableVertexAttribArray(this.program.attributes.distanceAlong);
    gl.vertexAttribDivisor(this.program.attributes.radius, 0);
    gl.disableVertexAttribArray(this.program.attributes.radius);
    gl.vertexAttribDivisor(this.program.attributes.pattern, 0);
    gl.disableVertexAttribArray(this.program.attributes.pattern);
  }
}

interface LineProgramData extends ProgramData {
  attributes: {
    colorFill: number;
    colorStroke: number;
    distanceAlong: number;
    next: number;
    position: number;
    previous: number;
    radius: number;
    pattern: number;
  };
  uniforms: {
    cameraCenter: WebGLUniformLocation;
    flattenFactor: WebGLUniformLocation;
    halfWorldSize: WebGLUniformLocation;
    inverseHalfViewportSize: WebGLUniformLocation;
    renderBorder: WebGLUniformLocation;
    sphericalMvp: WebGLUniformLocation;
    z: WebGLUniformLocation;
  };
}

function createLineProgram(gl: WebGL2RenderingContext): LineProgramData {
  const programId = checkExists(gl.createProgram());

  const vs = `#version 300 es
      // This is a Mercator coordinate ranging from -1 to 1 on both x and y
      uniform highp vec4 cameraCenter;
      uniform mediump float flattenFactor; // 0 to 1
      uniform highp float halfWorldSize;
      uniform highp vec2 inverseHalfViewportSize;
      uniform bool renderBorder;
      uniform highp mat4 sphericalMvp;
      uniform highp float z;

      // x is either 0 or 1, y is either -1 or 1.
      in highp vec2 position;

      // These are Mercator coordinates ranging from -1 to 1 on both x and y
      in highp vec2 previous;
      in highp vec2 next;

      in highp float colorFill;
      in highp float colorStroke;
      // A distance in Mercator coordinates
      in highp float distanceAlong;
      // This is a radius in pixels
      in highp float radius;
      // See PATTERN_CODES. The mode is 0 for solid, 1 dashed, 2 ticked, 3 alternating, and 4
      // dotted.
      in uint pattern;

      // See https://github.com/visgl/luma.gl/issues/1764
      invariant gl_Position;

      out lowp vec4 fragColorFill;
      out lowp vec4 fragColorStroke;
      out lowp float fragDistanceAlong;
      out lowp float fragRadius;
      out lowp float fragCore;
      out lowp float fragOnShare;
      out lowp float fragAlternate;
      out lowp float fragTicks;
      out lowp float fragDots;
      out mediump float fragPeriod;
      // Pixels per unit of fragDistanceAlong, which steps with zoom
      out mediump float fragAlongPx;
      out lowp float fragDistanceOrtho;
      // Pixels past each end of the segment, positive only beyond that end
      out highp float fragPastStart;
      out highp float fragPastEnd;
      out mediump float fragCapRadius;
      out mediump float fragBehindHorizon;

      ${COLOR_OPERATIONS}
      ${FP64_OPERATIONS}
      ${SPHERE_OPERATIONS}

      vec2 perpendicular(vec2 v) {
        return vec2(-v.y, v.x);
      }

      void main() {
        uint mode = pattern & 7u;
        vec2 center = position.x < 0.5 ? previous : next;
        vec2 direction = next - previous;
        // A zero length segment draws as a circle, which is how we draw points.
        vec2 along = direction == vec2(0.) ? vec2(1., 0.) : normalize(direction);
        vec2 perp = perpendicular(along);
        vec4 location = sub_fp64(split(center), cameraCenter);
        if (location.x + location.y > 1.) {
          location.x -= 2.;
        } else if (location.x + location.y < -1.) {
          location.x += 2.;
        }
        // Ticks reach three times the line's radius, so the quad has to cover them. The casing
        // reaches a quarter pixel further to fit its antialiasing.
        highp float extent = mode == 2u ? 3. * radius : radius;
        highp float actualRadius = renderBorder ? extent + 0.25 : extent - 1.;
        // The quad runs past each end by the cap's radius. The fill stops at the core's own fill
        // radius, or else at a join its casing-colored edge would ring the line beside it. Ticks
        // don't widen the cap.
        highp float capRadius =
            renderBorder
                ? radius + 0.25
                : max(0., radius - 1. - (mode == 3u ? 1. : 0.));
        highp float endSign = 2. * position.x - 1.;
        vec2 push = perp * actualRadius * position.y + along * capRadius * endSign;
        // Only the camera subtraction needs fp64, because without it the map jitters when panning
        // at high zoom. The rest can be float32 because gl_Position is float32 anyway.
        vec2 relative = vec2(location.x + location.y, location.z + location.w);
        vec2 p = (relative * halfWorldSize + push) * inverseHalfViewportSize;
        vec4 mercator = vec4(p, -1, 1);

        // sphereFromMercator and horizonDistance each cost a tanh, an asin, and four more
        // transcendentals, and mix discards all of it once flattenFactor reaches 1, which happens
        // around zoom 10 at mid latitudes. flattenFactor is a uniform, so the branch is coherent
        // across the draw.
        vec4 spherical = vec4(0.);
        highp float behindHorizon = 1.;
        if (flattenFactor < 1.) {
          vec3 spherePos = sphereFromMercator(center);
          spherical = sphericalMvp * vec4(spherePos, 1.0);
          spherical.xy += push * inverseHalfViewportSize * spherical.w;

          // Signed horizon distance for fragment-level cull on the back of the globe, see
          // triangle_program for context.
          behindHorizon = horizonDistance(spherePos);
        }

        gl_Position = mix(spherical, mercator, flattenFactor);
        gl_Position /= gl_Position.w;
        // Depth is the layer alone, the same as triangle_program.ts, or else a line that is farther
        // from the camera loses the depth test to a lower layer's raster tile.
        gl_Position.z = 1. - 2. * z;

        fragBehindHorizon = behindHorizon;

        fragColorFill = uint32FToVec4(colorFill);
        fragColorStroke = uint32FToVec4(colorStroke);
        // We want to avoid patterns "dancing" as zoom changes, so we make this more of a step
        // change.
        // The dashes continue into the caps, or else a vertex inside a dash fills the gaps on either
        // side with a whole circle.
        highp float stepped = exp2(floor(2. * log2(halfWorldSize)) / 2.);
        fragDistanceAlong =
            stepped
                * (distanceAlong
                    + position.x * length(direction)
                    + endSign * capRadius / halfWorldSize);
        fragAlongPx = halfWorldSize / stepped;
        fragDistanceOrtho = position.y * actualRadius;
        highp float span = length(direction) * halfWorldSize + 2. * capRadius;
        fragPastStart = capRadius - position.x * span;
        fragPastEnd = capRadius - (1. - position.x) * span;
        fragCapRadius = capRadius;
        fragRadius = extent;
        fragCore = radius;
        // Alternating dashes default to twice as long, because a dash of fill reads as a gap
        // otherwise.
        highp float period = float((pattern >> 8) & 255u);
        fragPeriod = period > 0. ? period : mode == 3u ? 16. : 8.;
        highp float on = float((pattern >> 16) & 255u) / 255.;
        fragOnShare =
            mode == 1u || mode == 3u
                ? (on > 0. ? on : mode == 3u ? 0.65 : 0.5)
                : 1.0;
        fragAlternate = mode == 3u ? 1.0 : 0.0;
        fragTicks = mode == 2u ? 1.0 : 0.0;
        fragDots = mode == 4u ? 1.0 : 0.0;
      }
    `;
  const fs = `#version 300 es
      uniform mediump float flattenFactor;

      in lowp vec4 fragColorFill;
      in lowp vec4 fragColorStroke;
      in lowp float fragDistanceAlong;
      in lowp float fragDistanceOrtho;
      in lowp float fragRadius;
      in lowp float fragCore;
      in lowp float fragOnShare;
      in lowp float fragAlternate;
      in lowp float fragTicks;
      in lowp float fragDots;
      in mediump float fragPeriod;
      in mediump float fragAlongPx;
      in highp float fragPastStart;
      in highp float fragPastEnd;
      in mediump float fragCapRadius;
      in mediump float fragBehindHorizon;

      out lowp vec4 fragColor;

      void main() {
        // Distance from the segment itself, which is the distance from the nearest endpoint past
        // either end.
        highp float past = max(max(fragPastStart, fragPastEnd), 0.);
        mediump float distance = length(vec2(past, fragDistanceOrtho));
        if ((flattenFactor < 1.0 && fragBehindHorizon < 0.0)
            || (past > 0. && distance > fragCapRadius)) {
          discard;
        }
        mediump float phase = fract(fragDistanceAlong / fragPeriod);
        // A dot is a disc as wide as the line, centered in its period. Its along distance is in real
        // pixels, or else the zoom stepping squashes it into an ellipse.
        if (fragDots > 0.) {
          distance =
              length(vec2((phase - 0.5) * fragPeriod * fragAlongPx, fragDistanceOrtho));
        }
        mediump float a = 1. - smoothstep(0., 1., clamp(distance + 0.75 - fragRadius, 0., 1.));
        // 0 is fill, 1 is stroke. Alternating widens the stroke to 2 pixels so the dashes sit
        // inside a casing.
        mediump float m =
            smoothstep(0., 1., clamp(distance + 1. + fragAlternate - fragRadius, 0., 1.));

        lowp float on = phase <= fragOnShare ? 1. : 0.;
        // Alternating fills the gaps between dashes with the stroke color instead of dropping them.
        lowp vec4 color = mix(fragColorFill, fragColorStroke, max(m, fragAlternate * (1. - on)));
        lowp float shown = max(on, fragAlternate);
        // Outside the line itself only the ticks draw, one every 24 pixels, as thick as the line
        // up to 2 pixels. The caps have no ticks, or else a tick near a join fans out.
        lowp float core = 1. - clamp(distance - fragCore + 0.75, 0., 1.);
        mediump float width = min(2., 2. * fragCore);
        lowp float tick = past == 0. && mod(fragDistanceAlong, 24.) < width ? 1. : 0.;
        lowp float ticked = mix(1., max(core, tick), fragTicks);
        fragColor = shown * ticked * vec4(color.rgb * color.a, color.a) * a;
      }
  `;

  const vertexId = checkExists(gl.createShader(gl.VERTEX_SHADER));
  gl.shaderSource(vertexId, vs);
  gl.compileShader(vertexId);
  if (!gl.getShaderParameter(vertexId, gl.COMPILE_STATUS)) {
    throw new Error(`Unable to compile line vertex shader: ${gl.getShaderInfoLog(vertexId)}`);
  }
  gl.attachShader(programId, vertexId);

  const fragmentId = checkExists(gl.createShader(gl.FRAGMENT_SHADER));
  gl.shaderSource(fragmentId, fs);
  gl.compileShader(fragmentId);
  if (!gl.getShaderParameter(fragmentId, gl.COMPILE_STATUS)) {
    throw new Error(`Unable to compile line fragment shader: ${gl.getShaderInfoLog(fragmentId)}`);
  }
  gl.attachShader(programId, fragmentId);

  gl.linkProgram(programId);
  if (!gl.getProgramParameter(programId, gl.LINK_STATUS)) {
    throw new Error(`Unable to link line program: ${gl.getProgramInfoLog(programId)}`);
  }

  return {
    handle: programId,
    attributes: {
      colorFill: checkExists(gl.getAttribLocation(programId, 'colorFill')),
      colorStroke: checkExists(gl.getAttribLocation(programId, 'colorStroke')),
      next: checkExists(gl.getAttribLocation(programId, 'next')),
      position: checkExists(gl.getAttribLocation(programId, 'position')),
      previous: checkExists(gl.getAttribLocation(programId, 'previous')),
      distanceAlong: checkExists(gl.getAttribLocation(programId, 'distanceAlong')),
      radius: checkExists(gl.getAttribLocation(programId, 'radius')),
      pattern: checkExists(gl.getAttribLocation(programId, 'pattern')),
    },
    uniforms: {
      cameraCenter: checkExists(gl.getUniformLocation(programId, 'cameraCenter')),
      flattenFactor: checkExists(gl.getUniformLocation(programId, 'flattenFactor')),
      halfWorldSize: checkExists(gl.getUniformLocation(programId, 'halfWorldSize')),
      inverseHalfViewportSize:
        checkExists(gl.getUniformLocation(programId, 'inverseHalfViewportSize')),
      renderBorder: checkExists(gl.getUniformLocation(programId, 'renderBorder')),
      sphericalMvp: checkExists(gl.getUniformLocation(programId, 'sphericalMvp')),
      z: checkExists(gl.getUniformLocation(programId, 'z')),
    },
  };
}
