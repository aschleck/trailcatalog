import { Camera } from 'java/org/trailcatalog/client/camera';
import { RenderPlan, RenderPlanner } from 'java/org/trailcatalog/client/render_planner';
import { checkExists, Vec2, Vec4 } from 'java/org/trailcatalog/client/support';

export const MAX_GEOMETRY_BYTES = 28_000_000;

export class Renderer {

  private readonly geometryBuffer: WebGLBuffer;
  private readonly wayProgram: WayProgram;
  private area: Vec2;
  private renderPlan: RenderPlan;

  constructor(
      private readonly gl: WebGL2RenderingContext,
      area: Vec2) {
    this.geometryBuffer = this.createBuffer(MAX_GEOMETRY_BYTES);
    this.wayProgram = createWayProgram(this.gl);
    this.area = area;
    this.renderPlan = {
      billboards: [],
      lines: [],
    };
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

  render(camera: Camera): void {
    const gl = this.gl;

    gl.clearColor(0.85, 0.85, 0.85, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.geometryBuffer);

    gl.useProgram(this.wayProgram.id);
    const center = splitVec2(camera.centerPixel);
    gl.uniform4fv(this.wayProgram.uniforms.center, center);
    gl.uniform4f(this.wayProgram.uniforms.color, 0.4, 0.2, 0.6, 1);
    gl.uniform2f(
        this.wayProgram.uniforms.halfViewportSize, this.area[0] / 2, this.area[1] / 2);
    gl.uniform1f(this.wayProgram.uniforms.halfWorldSize, camera.worldSize / 2);

    gl.enableVertexAttribArray(this.wayProgram.attributes.position);
    gl.vertexAttribPointer(
        this.wayProgram.attributes.position,
        4,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ 16,
        /* offset= */ 0);
    gl.enableVertexAttribArray(this.wayProgram.attributes.next);
    gl.vertexAttribPointer(
        this.wayProgram.attributes.next,
        4,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ 16,
        /* offset= */ 32);

    for (const line of this.renderPlan.lines) {
      gl.drawArrays(gl.TRIANGLE_STRIP, line.offset, line.count);
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  resize(area: Vec2): void {
    this.area = area;
    this.gl.viewport(0, 0, area[0], area[1]);
  }
}

interface WayProgram {
  id: WebGLProgram;

  attributes: {
    position: number;
    next: number;
  }

  uniforms: {
    center: WebGLUniformLocation;
    color: WebGLUniformLocation;
    halfViewportSize: WebGLUniformLocation;
    halfWorldSize: WebGLUniformLocation;
  }
}

function createWayProgram(gl: WebGL2RenderingContext): WayProgram {
  const programId = checkExists(gl.createProgram());

  const vs = `#version 300 es
      // This is a Mercator coordinate ranging from -1 to 1 on both x and y
      uniform highp vec4 center;
      uniform highp vec2 halfViewportSize;
      uniform highp float halfWorldSize;

      // These are Mercator coordinates ranging from -1 to 1 on both x and y
      in highp vec4 position;
      in highp vec4 next;

      vec2 reduce(vec4 v) {
        return vec2(v.x + v.y, v.z + v.w);
      }

      void main() {
        vec2 direction = normalize(reduce(next - position));
        vec2 perp = vec2(-direction.y, direction.x);
        vec2 push = perp * float((gl_VertexID % 2) * 2 - 1) * 1.;

        vec2 worldCoord = reduce((position - center) * halfWorldSize) + push;
        gl_Position =
            vec4(worldCoord.x / halfViewportSize.x, worldCoord.y / halfViewportSize.y, 0, 1);
      }
    `;
  const fs = `#version 300 es
      uniform mediump vec4 color;
      out mediump vec4 fragColor;

      void main() {
        fragColor = color;
      }
  `;

  const vertexId = checkExists(gl.createShader(gl.VERTEX_SHADER));
  gl.shaderSource(vertexId, vs);
  gl.compileShader(vertexId);
  if (!gl.getShaderParameter(vertexId, gl.COMPILE_STATUS)) {
    throw new Error(`Unable to compile way vertex shader: ${gl.getShaderInfoLog(vertexId)}`);
  }
  gl.attachShader(programId, vertexId);

  const fragmentId = checkExists(gl.createShader(gl.FRAGMENT_SHADER));
  gl.shaderSource(fragmentId, fs);
  gl.compileShader(fragmentId);
  if (!gl.getShaderParameter(fragmentId, gl.COMPILE_STATUS)) {
    throw new Error(`Unable to compile way fragment shader: ${gl.getShaderInfoLog(vertexId)}`);
  }
  gl.attachShader(programId, fragmentId);

  gl.linkProgram(programId);
  if (!gl.getProgramParameter(programId, gl.LINK_STATUS)) {
    throw new Error(`Unable to link way program: ${gl.getProgramInfoLog(programId)}`);
  }

  return {
    id: programId,
    attributes: {
      position: gl.getAttribLocation(programId, 'position'),
      next: gl.getAttribLocation(programId, 'next'),
    },
    uniforms: {
      center: checkExists(gl.getUniformLocation(programId, 'center')),
      color: checkExists(gl.getUniformLocation(programId, 'color')),
      halfViewportSize: checkExists(gl.getUniformLocation(programId, 'halfViewportSize')),
      halfWorldSize: checkExists(gl.getUniformLocation(programId, 'halfWorldSize')),
    },
  };
}

enum RenderType {
  NoChange = 1,
  CameraChange = 2,
  DataChange = 3,
}

function splitVec2(v: Vec2): Vec4 {
  const x = v[0];
  const xF = Math.fround(x);
  const y = v[1];
  const yF = Math.fround(y);
  return [xF, x - xF, yF, y - yF];
}

