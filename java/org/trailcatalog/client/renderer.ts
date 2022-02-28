import { checkExists } from './models/asserts';
import { Vec2, Vec4 } from './models/types';

import { Camera } from './camera';
import { RenderPlan, RenderPlanner } from './render_planner';

export const MAX_GEOMETRY_BYTES = 28_000_000;

export class Renderer {

  private readonly billboardBuffer: WebGLBuffer;
  private readonly billboardProgram: BillboardProgram;
  private readonly geometryBuffer: WebGLBuffer;
  private readonly lineBuffer: WebGLBuffer;
  private readonly lineProgram: LineProgram;
  private area: Vec2;
  private renderPlan: RenderPlan;

  constructor(
      private readonly gl: WebGL2RenderingContext,
      area: Vec2) {
    this.billboardBuffer =
            this.createStaticBuffer(
                    new Float32Array([
                      -0.5, -0.5, 0, 1,
                      -0.5, 0.5, 0, 0,
                      0.5, -0.5, 1, 1,
                      0.5, 0.5, 1, 0,
                    ]));
    this.billboardProgram = createBillboardProgram(gl);
    this.geometryBuffer = this.createBuffer(MAX_GEOMETRY_BYTES);
    this.lineBuffer =
            this.createStaticBuffer(
                    new Float32Array([
                      0, -1,
                      0, 1,
                      1, -1,
                      1, 1,
                    ]));
    this.lineProgram = createLineProgram(gl);
    this.area = area;
    this.renderPlan = {
      billboards: [],
      lines: [],
    };

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  apply(planner: RenderPlanner): void {
    this.renderPlan = planner.target;

    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.geometryBuffer);
    gl.bufferSubData(
      gl.ARRAY_BUFFER, 0, new Uint8Array(planner.geometry), 0, planner.geometryByteSize);
  }

  createBuffer(byteSize: number): WebGLBuffer {
    const gl = this.gl;
    const buffer = checkExists(gl.createBuffer());
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, byteSize, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    return buffer;
  }

  createStaticBuffer(data: Float32Array): WebGLBuffer {
    const gl = this.gl;
    const buffer = checkExists(gl.createBuffer());
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    return buffer;
  }

  createTexture(): WebGLTexture {
    return checkExists(this.gl.createTexture());
  }

  render(camera: Camera): void {
    const gl = this.gl;

    gl.clearColor(0.85, 0.85, 0.85, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    this.renderBillboards(camera);
    this.renderLines(camera);
  }

  private renderBillboards(camera: Camera): void {
    const gl = this.gl;
    gl.useProgram(this.billboardProgram.id);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.billboardBuffer);

    const cameraCenter = splitVec2(camera.centerPixel);
    gl.uniform4fv(this.billboardProgram.uniforms.cameraCenter, cameraCenter);
    gl.uniform2f(
        this.billboardProgram.uniforms.halfViewportSize, this.area[0] / 2, this.area[1] / 2);
    gl.uniform1f(this.billboardProgram.uniforms.halfWorldSize, camera.worldRadius);

    gl.enableVertexAttribArray(this.billboardProgram.attributes.position);
    gl.vertexAttribPointer(
        this.billboardProgram.attributes.position,
        2,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ 16,
        /* offset= */ 0);
    gl.enableVertexAttribArray(this.billboardProgram.attributes.colorPosition);
    gl.vertexAttribPointer(
        this.billboardProgram.attributes.colorPosition,
        2,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ 16,
        /* offset= */ 8);

    gl.activeTexture(gl.TEXTURE0);

    for (const billboard of this.renderPlan.billboards) {
      gl.uniform4fv(this.billboardProgram.uniforms.center, billboard.center);
      gl.uniform4fv(this.billboardProgram.uniforms.size, billboard.size);
      gl.bindTexture(gl.TEXTURE_2D, billboard.texture);
      gl.uniform1i(this.billboardProgram.uniforms.color, 0);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.disableVertexAttribArray(this.billboardProgram.attributes.position);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.useProgram(null);
  }

  private renderLines(camera: Camera): void {
    for (const line of this.renderPlan.lines) {
      this.renderLine(line, camera);
    }
  }

  private renderLine(line: {offset: number; count: number}, camera: Camera): void {
    const gl = this.gl;
    gl.useProgram(this.lineProgram.id);

    const cameraCenter = splitVec2(camera.centerPixel);
    gl.uniform4fv(this.lineProgram.uniforms.cameraCenter, cameraCenter);
    gl.uniform4f(this.lineProgram.uniforms.colorStipple, 0.1, 0.1, 0.1, 1);
    gl.uniform4f(this.lineProgram.uniforms.colorStipple, 1, 1, 1, 1);
    gl.uniform2f(
        this.lineProgram.uniforms.halfViewportSize, this.area[0] / 2, this.area[1] / 2);
    gl.uniform1f(this.lineProgram.uniforms.halfWorldSize, camera.worldRadius);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuffer);
    gl.enableVertexAttribArray(this.lineProgram.attributes.position);
    gl.vertexAttribPointer(
        this.lineProgram.attributes.position,
        2,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ 0,
        /* offset= */ 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.geometryBuffer);
    gl.enableVertexAttribArray(this.lineProgram.attributes.previous);
    gl.vertexAttribDivisor(this.lineProgram.attributes.previous, 1);
    gl.vertexAttribPointer(
        this.lineProgram.attributes.previous,
        4,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ 36,
        /* offset= */ line.offset);
    gl.enableVertexAttribArray(this.lineProgram.attributes.previousDistance);
    gl.vertexAttribDivisor(this.lineProgram.attributes.previousDistance, 1);
    gl.vertexAttribPointer(
        this.lineProgram.attributes.previousDistance,
        1,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ 36,
        /* offset= */ line.offset + 32);
    gl.enableVertexAttribArray(this.lineProgram.attributes.next);
    gl.vertexAttribDivisor(this.lineProgram.attributes.next, 1);
    gl.vertexAttribPointer(
        this.lineProgram.attributes.next,
        4,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ 36,
        /* offset= */ line.offset + 16);

    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, line.count);

    //for (const line of this.renderPlan.lines) {
    //  gl.uniform4fv(this.lineProgram.uniforms.colorFill, line.colorFill);
    //}

    gl.vertexAttribDivisor(this.lineProgram.attributes.previous, 0);
    gl.disableVertexAttribArray(this.lineProgram.attributes.previous);
    gl.vertexAttribDivisor(this.lineProgram.attributes.previousDistance, 0);
    gl.disableVertexAttribArray(this.lineProgram.attributes.previousDistance);
    gl.disableVertexAttribArray(this.lineProgram.attributes.position);
    gl.vertexAttribDivisor(this.lineProgram.attributes.next, 0);
    gl.disableVertexAttribArray(this.lineProgram.attributes.next);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.useProgram(null);
  }

  resize(area: Vec2): void {
    this.area = area;
    this.gl.viewport(0, 0, area[0], area[1]);
  }

  uploadTexture(bitmap: ImageBitmap, target: WebGLTexture): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, target);
    gl.texImage2D(
        gl.TEXTURE_2D,
        /* level= */ 0,
        gl.RGB,
        gl.RGB,
        gl.UNSIGNED_BYTE,
        bitmap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }
}

interface BillboardProgram {
  id: WebGLProgram;

  attributes: {
    position: number;
    colorPosition: number;
  }

  uniforms: {
    cameraCenter: WebGLUniformLocation;
    center: WebGLUniformLocation;
    color: WebGLUniformLocation;
    halfViewportSize: WebGLUniformLocation;
    halfWorldSize: WebGLUniformLocation;
    size: WebGLUniformLocation;
  }
}

function createBillboardProgram(gl: WebGL2RenderingContext): BillboardProgram {
  const programId = checkExists(gl.createProgram());

  const vs = `#version 300 es
      // These are Mercator coordinates ranging from -1 to 1 on both x and y
      uniform highp vec4 cameraCenter;
      uniform highp vec4 center;
      uniform highp vec4 size;

      // These are in pixels
      uniform highp vec2 halfViewportSize;
      uniform highp float halfWorldSize;

      in highp vec2 position;
      in mediump vec2 colorPosition;

      out mediump vec2 fragColorPosition;

      vec2 reduce(vec4 v) {
        return vec2(v.x + v.y, v.z + v.w);
      }

      void main() {
        vec4 location =
            center - cameraCenter + vec4(position.x * size.xy, position.y * size.zw);
        vec4 worldCoord = location * halfWorldSize;
        gl_Position = vec4(reduce(worldCoord) / halfViewportSize, 0, 1);
        fragColorPosition = colorPosition;
      }
    `;
  const fs = `#version 300 es
      uniform sampler2D color;
      in mediump vec2 fragColorPosition;
      out mediump vec4 fragColor;

      void main() {
        fragColor = texture(color, fragColorPosition);
      }
  `;

  const vertexId = checkExists(gl.createShader(gl.VERTEX_SHADER));
  gl.shaderSource(vertexId, vs);
  gl.compileShader(vertexId);
  if (!gl.getShaderParameter(vertexId, gl.COMPILE_STATUS)) {
    throw new Error(`Unable to compile billboard vertex shader: ${gl.getShaderInfoLog(vertexId)}`);
  }
  gl.attachShader(programId, vertexId);

  const fragmentId = checkExists(gl.createShader(gl.FRAGMENT_SHADER));
  gl.shaderSource(fragmentId, fs);
  gl.compileShader(fragmentId);
  if (!gl.getShaderParameter(fragmentId, gl.COMPILE_STATUS)) {
    throw new Error(`Unable to compile billboard fragment shader: ${gl.getShaderInfoLog(vertexId)}`);
  }
  gl.attachShader(programId, fragmentId);

  gl.linkProgram(programId);
  if (!gl.getProgramParameter(programId, gl.LINK_STATUS)) {
    throw new Error(`Unable to link billboard program: ${gl.getProgramInfoLog(programId)}`);
  }

  return {
    id: programId,
    attributes: {
      position: gl.getAttribLocation(programId, 'position'),
      colorPosition: gl.getAttribLocation(programId, 'colorPosition'),
    },
    uniforms: {
      cameraCenter: checkExists(gl.getUniformLocation(programId, 'cameraCenter')),
      center: checkExists(gl.getUniformLocation(programId, 'center')),
      color: checkExists(gl.getUniformLocation(programId, 'color')),
      halfViewportSize: checkExists(gl.getUniformLocation(programId, 'halfViewportSize')),
      halfWorldSize: checkExists(gl.getUniformLocation(programId, 'halfWorldSize')),
      size: checkExists(gl.getUniformLocation(programId, 'size')),
    },
  };
}

interface LineProgram {
  id: WebGLProgram;

  attributes: {
    previous: number;
    previousDistance: number;
    position: number;
    next: number;
  }

  uniforms: {
    cameraCenter: WebGLUniformLocation;
    colorFill: WebGLUniformLocation;
    colorStipple: WebGLUniformLocation;
    halfViewportSize: WebGLUniformLocation;
    halfWorldSize: WebGLUniformLocation;
  }
}

function createLineProgram(gl: WebGL2RenderingContext): LineProgram {
  const programId = checkExists(gl.createProgram());

  const vs = `#version 300 es
      // This is a Mercator coordinate ranging from -1 to 1 on both x and y
      uniform highp vec4 cameraCenter;
      uniform highp vec2 halfViewportSize;
      uniform highp float halfWorldSize;

      in highp vec2 position;

      // These are Mercator coordinates ranging from -1 to 1 on both x and y
      in highp vec4 previous;
      in highp float previousDistance;
      in highp vec4 next;

      out highp float fragDistanceAlong;
      out highp float fragDistanceOrtho;

      vec4 divide2Into64(vec4 v, vec2 divisor) {
        return vec4(v.xy / divisor.x, v.zw / divisor.y);
      }

      vec4 perpendicular64(vec4 v) {
        return vec4(-v.zw, v.xy);
      }

      float magnitude64(vec4 v) {
        return sqrt(
            v.x * v.x + 2. * v.x * v.y + v.y * v.y +
            v.z * v.z + 2. * v.z * v.w + v.w * v.w);
      }

      vec4 normalize64(vec4 v) {
        return v / magnitude64(v);
      }

      vec2 reduce64(vec4 v) {
        return vec2(v.x + v.y, v.z + v.w);
      }

      void main() {
        vec4 direction = next - previous;
        vec4 perpendicular = perpendicular64(normalize64(direction));
        vec4 location = -cameraCenter + previous + direction * position.x;
        vec4 worldCoord = location * halfWorldSize + perpendicular * 3. * position.y;
        gl_Position = vec4(reduce64(divide2Into64(worldCoord, halfViewportSize)), 0, 1);

        float dx = magnitude64(direction) - previousDistance;
        fragDistanceAlong = (previousDistance + dx * position.x) * pow(2., 15.);
        fragDistanceOrtho = position.y;
      }
    `;
  const fs = `#version 300 es
      uniform lowp vec4 colorFill;
      uniform lowp vec4 colorStipple;
      in highp float fragDistanceAlong;
      in highp float fragDistanceOrtho;
      out lowp vec4 fragColor;

      void main() {
        //mediump vec4 stipple = float(abs(fragDistanceOrtho) < 0.5 && mod(fragDistanceAlong, 8.) > 4.) * colorStipple;
        mediump vec4 stipple = float(fragDistanceAlong / 100.) * colorStipple;
        fragColor = vec4(1, 1, 1, 1) + (1. - stipple.w) * colorFill + stipple;
        lowp float c = (sin(fragDistanceAlong) + 1.) / 2.;
        fragColor = vec4(c, 1. - c, 0, 1);
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
    id: programId,
    attributes: {
      previous: gl.getAttribLocation(programId, 'previous'),
      previousDistance: gl.getAttribLocation(programId, 'previousDistance'),
      position: gl.getAttribLocation(programId, 'position'),
      next: gl.getAttribLocation(programId, 'next'),
    },
    uniforms: {
      cameraCenter: checkExists(gl.getUniformLocation(programId, 'cameraCenter')),
      colorFill: checkExists(gl.getUniformLocation(programId, 'colorFill')),
      colorStipple: checkExists(gl.getUniformLocation(programId, 'colorStipple')),
      halfViewportSize: checkExists(gl.getUniformLocation(programId, 'halfViewportSize')),
      halfWorldSize: checkExists(gl.getUniformLocation(programId, 'halfWorldSize')),
    },
  };
}

function splitVec2(v: Vec2): Vec4 {
  const x = v[0];
  const xF = Math.fround(x);
  const y = v[1];
  const yF = Math.fround(y);
  return [xF, x - xF, yF, y - yF];
}

