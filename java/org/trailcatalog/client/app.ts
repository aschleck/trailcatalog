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
    return projectLatLng(this.center);
  }

  get worldSize(): number {
    return 256 * Math.pow(2, this.zoom);
  }

  translate(dPixels: Vec2): void {
    const centerPixel = projectLatLng(this.center);
    const worldYPixel = centerPixel[1] + dPixels[1] * this.inverseWorldSize * 2;
    const newLat = Math.asin(Math.tanh(worldYPixel * Math.PI));
    const dLng = Math.PI * dPixels[0] * this.inverseWorldSize * 2;
    this.center = S2LatLng.fromRadians(newLat, this.center.lngRadians() + dLng);
  }

  viewportBounds(widthPx: number, heightPx: number): S2LatLngRect {
    const centerPixel = projectLatLng(this.center);
    const dY = heightPx * this.inverseWorldSize;
    const lowLat = Math.asin(Math.tanh((centerPixel[1] - dY) * Math.PI));
    const highLat = Math.asin(Math.tanh((centerPixel[1] + dY) * Math.PI));
    const dLng = Math.PI * widthPx * this.inverseWorldSize;
    return S2LatLngRect.fromPointPair(
        S2LatLng.fromRadians(lowLat, this.center.lngRadians() - dLng),
        S2LatLng.fromRadians(highLat, this.center.lngRadians() + dLng));
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

interface RenderPlan {
  lines: Array<{
    offset: number;
    count: number;
  }>;
}

class Renderer {

  private readonly geometryBuffer: WebGLBuffer;
  private readonly wayProgram: WayProgram;
  private area: Vec2;
  private renderPlan: RenderPlan|undefined;

  constructor(private readonly gl: WebGL2RenderingContext, area: Vec2) {
    this.geometryBuffer = checkExists(gl.createBuffer());
    this.wayProgram = createWayProgram(this.gl);
    this.area = area;
  }

  plan(lines: Array<{
    splitVertices: ArrayBuffer;
  }>): void {
    let vertexCount = 0;
    for (const line of lines) {
      vertexCount += line.splitVertices.byteLength / 16 * 2 + 2;
    }

    this.renderPlan = {
      lines: [],
    };

    const vertices = new Float64Array(vertexCount * 2);
    let vertexOffset = 0;
    for (const line of lines) {
      const doubles = new Float64Array(line.splitVertices);
      this.renderPlan.lines.push({
        offset: vertexOffset / 2,
        count: doubles.length, // this math is cheeky
      });

      for (let i = 0; i < doubles.length; i += 2) {
        const x = doubles[i + 0];
        const y = doubles[i + 1];
        vertices.set([x, y, x, y], vertexOffset + i * 2);
      }
      vertexOffset += doubles.length * 2;

      // This is shady because we reverse the perpendiculars here. It would be safer to extend the
      // line, but that takes work. This will likely break under culling.
      const x = doubles[doubles.length - 4];
      const y = doubles[doubles.length - 3];
      vertices.set([x, y, x, y], vertexOffset);
      vertexOffset += 4;
    }

    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.geometryBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  }

  render(camera: Camera): void {
    const gl = this.gl;

    gl.clearColor(0.85, 0.85, 0.85, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (!this.renderPlan) {
      return;
    }

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
  }

  resize(area: Vec2): void {
    this.area = area;
    this.gl.viewport(0, 0, area[0], area[1]);
  }
}

type S2CellToken = string & {brand: 'S2CellToken'};

class MapData {

  private byCells: Map<S2CellToken, ArrayBuffer>;
  private inFlight: Set<S2CellToken>;

  constructor() {
    this.byCells = new Map();
    this.inFlight = new Set();
  }

  fetchCells(cells: S2CellId[], callback: () => void): void {
    for (const cell of cells) {
      const token = cell.toToken() as S2CellToken;
      if (this.inFlight.has(token) || this.byCells.has(token)) {
        continue;
      }

      this.inFlight.add(token);
      fetch(`/api/fetch_cell/${token}`)
          .then(response => response.arrayBuffer())
          .then(buffer => {
            this.byCells.set(token, buffer);
            callback();
          })
          .finally(() => {
            this.inFlight.delete(token);
          });
    }
  }

  plan(cells: S2CellId[]): Array<{
    splitVertices: ArrayBuffer;
  }> {
    const calls = [];
    for (const cell of cells) {
      const buffer = this.byCells.get(cell.toToken() as S2CellToken);
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

enum RenderType {
  NoChange = 1,
  CameraChange = 2,
  DataChange = 3,
}

class Controller {

  private readonly camera: Camera;
  private readonly data: MapData;
  private readonly renderer: Renderer;

  private lastMousePosition: Vec2|undefined;
  private nextRender: RenderType;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.camera = new Camera();
    this.data = new MapData();
    this.renderer = new Renderer(checkExists(this.canvas.getContext('webgl2')), [-1, -1]);
    this.nextRender = RenderType.DataChange;

    window.addEventListener('resize', () => this.resize());
    this.resize();

    document.addEventListener('pointerdown', e => {
      this.lastMousePosition = [e.clientX, e.clientY];
    });
    document.addEventListener('pointermove', e => {
      if (!this.lastMousePosition) {
        return;
      }

      this.camera.translate([
          this.lastMousePosition[0] - e.clientX,
          -(this.lastMousePosition[1] - e.clientY),
      ]);
      this.lastMousePosition = [e.clientX, e.clientY];
      this.nextRender = RenderType.CameraChange;

      this.refetchData();
    });
    document.addEventListener('pointerup', e => {
      this.lastMousePosition = undefined;
    });

    const raf = () => {
      if (this.nextRender >= RenderType.CameraChange) {
        if (this.nextRender >= RenderType.DataChange) {
          this.renderer.plan(this.data.plan(this.cellsInView()));
        }
        this.renderer.render(this.camera);
      }
      this.nextRender = RenderType.NoChange;
      requestAnimationFrame(raf);
    };
    raf();
  }

  private refetchData(): void {
    this.data.fetchCells(this.cellsInView(), () => {
      this.nextRender = RenderType.DataChange;
    });
  }

  private resize(): void {
    const area = this.canvas.getBoundingClientRect();
    this.canvas.width = area.width;
    this.canvas.height = area.height;
    this.renderer.resize([area.width, area.height]);

    this.nextRender = RenderType.DataChange;
    this.refetchData();
  }

  private cellsInView(): S2CellId[] {
    const viewport = this.camera.viewportBounds(this.canvas.width, this.canvas.height);
    const cellsInArrayList = SimpleS2.cover(viewport);
    const cells = [];
    for (let i = 0; i < cellsInArrayList.size(); ++i) {
      cells.push(cellsInArrayList.getAtIndex(i));
    }
    return cells;
  }
}

function checkExists<V>(v: V|null|undefined): V {
  if (v === null || v === undefined) {
    throw new Error(`Argument is ${v}`);
  }
  return v;
}

function projectLatLng(ll: S2LatLng): Vec2 {
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

new Controller(document.getElementById('canvas') as HTMLCanvasElement);
