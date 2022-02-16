// import {assembleShaders, fp64arithmetic} from '@luma.gl/shadertools';

// import { S1Angle, S2LatLng, S2LatLngRect, SimpleS2 } from '../s2/SimpleS2';
import { S1Angle, S2CellId, S2LatLng, S2LatLngRect } from 'java/org/trailcatalog/s2';
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
    //this.center = S2LatLng.fromDegrees(46.859369, -121.747888);
    //this.zoom = 12;
    this.inverseWorldSize = 1 / this.worldSize;
  }

  get centerPixel(): Vec2 {
    return projectLatlng(this.center);
  }

  get worldSize(): number {
    return 256 * Math.pow(2, this.zoom);
  }

  translate(pixels: Vec2): void {
    const dLat = Math.asin(Math.tanh(pixels[1] * this.inverseWorldSize * 2));
    const dLng = Math.PI * pixels[0] * this.inverseWorldSize * 2;
    this.center = S2LatLng.fromRadians(
        this.center.latRadians() + dLat, this.center.lngRadians() + dLng);
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

  private readonly wayProgram: WayProgram;
  private area: Vec2;

  constructor(private readonly gl: WebGL2RenderingContext, area: Vec2) {
    this.wayProgram = createWayProgram(this.gl);
    this.area = area;
  }

  render(lines: Array<{
    splitVertices: ArrayBuffer;
  }>, camera: Camera): void {
    const calls = [];
    const vertices = [];
    for (const line of lines) {
      const doubles = new Float64Array(line.splitVertices);
      calls.push({
        offset: vertices.length / 2,
        count: doubles.length, // this math is cheeky
      });

      for (let i = 0; i < doubles.length; i += 2) {
        const x = doubles[i + 0];
        const y = doubles[i + 1];
        vertices.push(x);
        vertices.push(y);
        vertices.push(x);
        vertices.push(y);
      }

      // This is shady because we reverse the perpendiculars here. It would be safer to extend the
      // line, but that takes work. This will likely break under culling.
      const x = doubles[doubles.length - 4];
      const y = doubles[doubles.length - 3];
      vertices.push(x);
      vertices.push(y);
      vertices.push(x);
      vertices.push(y);
    }

    const gl = this.gl;

    gl.clearColor(0.2, 0.2, 0.2, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.wayProgram.id);
    const center = splitVec2(camera.centerPixel);
    gl.uniform4fv(this.wayProgram.uniforms.center, center);
    gl.uniform2f(
        this.wayProgram.uniforms.halfViewportSize, this.area[0] / 2, this.area[1] / 2);
    gl.uniform1f(this.wayProgram.uniforms.halfWorldSize, camera.worldSize / 2);

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

  resize(area: Vec2): void {
    this.area = area;
    this.gl.viewport(0, 0, area[0], area[1]);
  }
}

class MapData {

  private byCells: Map<string, ArrayBuffer>;

  constructor() {
    this.byCells = new Map();
  }

  async cellsInView(cells: S2CellId[]): Promise<void> {
    const responses = [];
    for (const cell of cells) {
      const token = cell.toToken();
      if (this.byCells.has(token)) {
        continue;
      }

      responses.push(
          fetch(`/api/fetch_cell/${cell.toToken()}`)
              .then(response => response.arrayBuffer())
              .then(buffer => {
                this.byCells.set(token, buffer);
              }));
    }
    await Promise.all(responses);
  }

  plan(cells: S2CellId[]): Array<{
    splitVertices: ArrayBuffer;
  }> {
    const calls = [];
    for (const cell of cells) {
      const buffer = this.byCells.get(cell.toToken());
      if (!buffer) {
        continue;
      }

      const data = new DataView(buffer);

      const wayCount = data.getInt32(0, /* littleEndian= */ true);
      if (wayCount === 0) {
        continue;
      }

      const WAY_OFFSET = 4;
      const WAY_STRIDE = 8 + 4 + 4;
      let vertexOffset = WAY_OFFSET + wayCount * WAY_STRIDE;
      for (let i = 0; i < wayCount; ++i) {
        const id = data.getBigInt64(i * WAY_STRIDE + WAY_OFFSET + 0, /* littleEndian= */ true);
        const type = data.getInt32(i * WAY_STRIDE + WAY_OFFSET + 8, /* littleEndian= */ true);
        const wayVertexBytes =
            data.getInt32(i * WAY_STRIDE + WAY_OFFSET + 12, /* littleEndian= */ true);
        const wayVertexCount = wayVertexBytes / 16;

        calls.push({
          splitVertices: buffer.slice(vertexOffset, vertexOffset + wayVertexBytes),
        });
        vertexOffset += wayVertexBytes;
      }
    }
    return calls;
  }
}

class Controller {

  private readonly camera: Camera;
  private readonly data: MapData;
  private readonly renderer: Renderer;

  private lastMousePosition: Vec2|undefined;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.camera = new Camera();
    this.data = new MapData();
    this.renderer = new Renderer(this.canvas.getContext('webgl2'), [-1, -1]);

    window.addEventListener('resize', () => this.resize());
    this.resize();

    this.canvas.addEventListener('mousedown', e => {
      this.lastMousePosition = [e.pageX, e.pageY];
    });
    this.canvas.addEventListener('mousemove', e => {
      if (!this.lastMousePosition) {
        return;
      }
      this.camera.translate([
          this.lastMousePosition[0] - e.pageX,
          -(this.lastMousePosition[1] - e.pageY),
      ]);
      this.lastMousePosition = [e.pageX, e.pageY];
      this.render();
    });
    this.canvas.addEventListener('mouseup', e => {
      this.lastMousePosition = undefined;
    });

  }

  async render(): Promise<void> {
    const viewport = this.camera.viewportBounds(this.canvas.width, this.canvas.height);
    const cellsInArrayList = SimpleS2.cover(viewport);
    const cells = [];
    for (let i = 0; i < cellsInArrayList.size(); ++i) {
      cells.push(cellsInArrayList.getAtIndex(i));
    }
    await this.data.cellsInView(cells);
    this.renderer.render(this.data.plan(cells), this.camera);
  }

  resize(): void {
    const area = this.canvas.getBoundingClientRect();
    this.canvas.width = area.width;
    this.canvas.height = area.height;
    this.renderer.resize([area.width, area.height]);
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

// TODO: assert little endian

new Controller(document.getElementById('canvas') as HTMLCanvasElement).render();
