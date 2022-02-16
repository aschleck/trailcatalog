// import {assembleShaders, fp64arithmetic} from '@luma.gl/shadertools';

// import { S1Angle, S2LatLng, S2LatLngRect, SimpleS2 } from '../s2/SimpleS2';
import { S1Angle, S2LatLng, S2LatLngRect } from 'java/org/trailcatalog/s2';
import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';

type Vec2 = [number, number];
type Vec4 = [number, number, number, number];

class Camera {
  private center: S2LatLng;
  private zoom: number;
  private inverseWorldSize: number;

  constructor() {
    this.center = S2LatLng.fromDegrees(47.644209, -122.139532);
    this.zoom = 15;
    this.inverseWorldSize = 1 / this.worldSize;
  }

  get centerPixel(): Vec2 {
    return projectLatlng(this.center);
  }

  get worldSize(): number {
    return 256 * Math.pow(2, this.zoom);
  }

  viewportBounds(widthPx: number, heightPx: number): S2LatLngRect {
    const dLat = Math.atan(Math.sinh(heightPx * this.inverseWorldSize));
    const dLng = Math.PI * widthPx * this.inverseWorldSize;
    return S2LatLngRect.fromPointPair(
        S2LatLng.fromRadians(this.center.latRadians() - dLat, this.center.lngRadians() - dLng),
        S2LatLng.fromRadians(this.center.latRadians() + dLat, this.center.lngRadians() + dLng));
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
    halfViewportSize: WebGLUniformLocation;
    halfWorldSize: WebGLUniformLocation;
  }
}

function createWayProgram(gl: WebGL2RenderingContext): WayProgram {
  const programId = gl.createProgram();

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
      out mediump vec4 fragColor;

      void main() {
        fragColor = vec4(1, 0, 0, 1);
      }
  `;

  const vertexId = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(vertexId, vs);
  gl.compileShader(vertexId);
  if (!gl.getShaderParameter(vertexId, gl.COMPILE_STATUS)) {
    throw new Error(`Unable to compile way vertex shader: ${gl.getShaderInfoLog(vertexId)}`);
  }
  gl.attachShader(programId, vertexId);

  const fragmentId = gl.createShader(gl.FRAGMENT_SHADER);
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
      center: gl.getUniformLocation(programId, 'center'),
      halfViewportSize: gl.getUniformLocation(programId, 'halfViewportSize'),
      halfWorldSize: gl.getUniformLocation(programId, 'halfWorldSize'),
    },
  };
}

class Renderer {
  private readonly camera: Camera;
  private readonly gl: WebGL2RenderingContext;
  private readonly wayProgram: WayProgram;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.camera = new Camera();
    this.gl = this.canvas.getContext('webgl2');
    window.addEventListener('resize', () => this.resize());

    this.wayProgram = createWayProgram(this.gl);
    this.resize();
  }

  async render(): Promise<void> {
    const viewport = this.camera.viewportBounds(this.canvas.width, this.canvas.height);
    const cells = SimpleS2.cover(viewport);
    const responses = [];
    for (let i = 0; i < cells.size(); ++i) {
      const cell = cells.getAtIndex(i);
      responses.push(
          fetch(`/api/fetch_cell/${cell.toToken()}`)
              .then(response => response.arrayBuffer())
              .then(buffer => [cell, buffer]));
    }
    const buffers = await Promise.all(responses);

    const vertices = [];
    let verticesOffset = 0;
    const calls = [];
    for (const [_, buffer] of buffers) {
      const data = new DataView(buffer);

      const wayCount = data.getInt32(0, /* littleEndian= */ true);
      if (wayCount == 0) {
        continue;
      }

      const WAY_OFFSET = 4;
      const WAY_STRIDE = 8 + 4 + 4;
      let sourceVerticesOffset = 0;
      for (let i = 0; i < wayCount; ++i) {
        const id = data.getBigInt64(i * WAY_STRIDE + WAY_OFFSET + 0, /* littleEndian= */ true);
        const type = data.getInt32(i * WAY_STRIDE + WAY_OFFSET + 8, /* littleEndian= */ true);
        const wayVertexBytes =
            data.getInt32(i * WAY_STRIDE + WAY_OFFSET + 12, /* littleEndian= */ true);
        const wayVertexCount = wayVertexBytes / 16;
        calls.push({
          type,
          offset: verticesOffset,
          count: wayVertexCount * 2,
        });

        const vertexOffset = WAY_OFFSET + wayCount * WAY_STRIDE + sourceVerticesOffset;
        for (let i = 0; i < wayVertexBytes; i += 16) {
          const x = data.getFloat64(vertexOffset + i + 0, /* littleEndian= */ true);
          const y = data.getFloat64(vertexOffset + i + 8, /* littleEndian= */ true);
          vertices.push(x);
          vertices.push(y);
          vertices.push(x);
          vertices.push(y);
        }
        sourceVerticesOffset += wayVertexBytes;
        verticesOffset += wayVertexCount * 2;

        // This is shady because we reverse the perpendiculars here. It would be safer to extend
        // the line, but that takes work. This will likely break under culling.
        const x = data.getFloat64(vertexOffset + wayVertexBytes - 32, /* littleEndian= */ true);
        const y = data.getFloat64(vertexOffset + wayVertexBytes - 24, /* littleEndian= */ true);
        vertices.push(x);
        vertices.push(y);
        vertices.push(x);
        vertices.push(y);
        verticesOffset += 2;
      }
    }

    const gl = this.gl;

    gl.clearColor(0.2, 0.2, 0.2, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.wayProgram.id);
    const center = splitVec2(this.camera.centerPixel);
    gl.uniform4fv(this.wayProgram.uniforms.center, center);
    gl.uniform2f(
        this.wayProgram.uniforms.halfViewportSize,
        this.canvas.width / 2,
        this.canvas.height / 2);
    gl.uniform1f(this.wayProgram.uniforms.halfWorldSize, this.camera.worldSize / 2);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float64Array(vertices), gl.STATIC_DRAW);

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

    for (const call of calls) {
      gl.drawArrays(gl.TRIANGLE_STRIP, call.offset, call.count);
    }

    gl.flush();
  }

  resize(): void {
    const area = this.canvas.getBoundingClientRect();
    this.canvas.width = area.width;
    this.canvas.height = area.height;
    this.gl.viewport(0, 0, area.width, area.height);
    this.render();
  }
}

function projectLatlng(ll: S2LatLng): Vec2 {
  const x = ll.lngRadians() / Math.PI;
  const y = Math.log((1 + Math.sin(ll.latRadians())) / (1 - Math.sin(ll.latRadians()))) / (2 * Math.PI);
  return [x, y];
}

function splitDouble(x: number): Vec2 {
  const a = Math.fround(x);
  return [a, x - a];
}

function splitVec2(v: Vec2): Vec4 {
  const x = v[0];
  const xF = Math.fround(x);
  const y = v[1];
  const yF = Math.fround(y);
  return [xF, x - xF, yF, y - yF];
}

new Renderer(document.getElementById('canvas') as HTMLCanvasElement);
