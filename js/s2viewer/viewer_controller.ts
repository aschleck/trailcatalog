import { Long, S2CellId, S2LatLng, S2LatLngRect, S2Loop, S2Polygon } from 'java/org/trailcatalog/s2';
import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';
import { checkExhaustive } from 'js/common/asserts';
import { Controller, Response } from 'js/corgi/controller';
import { CorgiEvent } from 'js/corgi/events';
import { HistoryService } from 'js/corgi/history/history_service';
import { CHANGED } from 'js/dino/events';
import { projectS2Loop, unprojectS2LatLng } from 'js/map2/camera';
import { rgbaToUint32 } from 'js/map2/common/math';
import { Vec2 } from 'js/map2/common/types';
import { MAP_MOVED } from 'js/map2/events';
import { Layer } from 'js/map2/layer';
import { RasterTileLayer } from 'js/map2/layers/raster_tile_layer';
import { MapController } from 'js/map2/map_controller';
import { Planner } from 'js/map2/rendering/planner';
import { Renderer } from 'js/map2/rendering/renderer';
import { Z_USER_DATA } from 'js/map2/z';

const CELL_BORDER = rgbaToUint32(1, 0, 0, 1);
export const MAX_S2_ZOOM = 31;
export const MAX_ZXY_ZOOM = 21;
export const ZOOM_LEVEL = -1;

export interface State {
  cellInput: string;
  cellType: 's2'|'z/x/y';
  level: number;
  selectedS2?: {
    cell: S2CellId;
    clickPx: [number, number];
  };
  selectedZxy?: {
    clickPx: [number, number];
    llr: S2LatLngRect;
    token: string;
    xyz: [number, number, number];
  };
}

type Deps = typeof ViewerController.deps;

export class ViewerController extends Controller<{}, Deps, HTMLElement, State> {

  static deps() {
    return {
      controllers: {
        map: MapController,
      },
    };
  }

  private readonly layer: CellLayer;
  private readonly mapController: MapController;
  lastChange: number;

  constructor(response: Response<ViewerController>) {
    super(response);
    this.layer = new CellLayer(this, response.deps.controllers.map.renderer);
    this.mapController = response.deps.controllers.map;
    this.lastChange = Date.now();

    this.mapController.setLayers([
      this.layer,
      new RasterTileLayer(
          /* copyright= */ undefined,
          'https://tiles.trailcatalog.org/hillshades/${id.zoom}/${id.x}/${id.y}.webp',
          /* extraZoom= */ 0,
          /* minZoom= */ 0,
          /* maxZoom= */ 12,
          this.mapController.renderer,
      ),
    ]);
  }

  onMove(e: CorgiEvent<typeof MAP_MOVED>): void {
    const {center, zoom} = e.detail;
    const url = new URL(window.location.href);
    url.searchParams.set('lat', center.latDegrees().toFixed(7));
    url.searchParams.set('lng', center.lngDegrees().toFixed(7));
    url.searchParams.set('zoom', zoom.toFixed(3));
    window.history.replaceState(null, '', url);
  }

  setCellType(e: CorgiEvent<typeof CHANGED>): void {
    const type = e.detail.value as 's2'|'z/x/y';
    let level;
    if (type === 's2') {
      level = Math.min(MAX_S2_ZOOM, this.state.level);
    } else if (type === 'z/x/y') {
      level = Math.min(MAX_ZXY_ZOOM, this.state.level);
    } else {
      throw checkExhaustive(type);
    }

    this.updateState({
      ...this.state,
      cellType: type,
      level,
    });
  }

  setLevel(e: CorgiEvent<typeof CHANGED>): void {
    this.updateState({
      ...this.state,
      level: Number(e.detail.value),
    });
  }

  showCells(e: CorgiEvent<typeof CHANGED>): void {
    this.updateState({
      ...this.state,
      cellInput: e.detail.value,
    });

    let values: string[];
    if (e.detail.value.trim() === '') {
      values = [];
    } else {
      values = e.detail.value.split(',').map(t => t.trim());
    }

    const s2Cells = [];
    const zxys = [];
    let valid = true;
    for (const value of values) {
      if (value.match(/\d+\/\d+\/\d+/)) {
        zxys.push(value);
        continue;
      }

      try {
        const fromToken = S2CellId.fromToken(value);
        if (value === fromToken.toToken()) {
          s2Cells.push(fromToken);
          continue;
        }
      } catch (e) {}

      if (value.match(/\d+/)) {
        try {
          const parsed = Long.fromString(value);
          if (value === parsed.toString()) {
            s2Cells.push(new S2CellId(parsed));
            continue;
          }
        } catch (e) {}
      }

      valid = false;
      break;
    }

    if (valid) {
      this.layer.s2Cells.clear();
      for (const cell of s2Cells) {
        this.layer.s2Cells.set(cell.toToken(), cell.toLoop(cell.level()));
      }

      this.layer.zxys.clear();
      for (const xyz of zxys) {
        const split = xyz.split("/").map(v => Number(v)) as [number, number, number];
        this.layer.zxys.set(xyz, split);
      }

      this.layerUpdated();
    }
  }

  selectCell(point: S2LatLng, px: [number, number]): void {
    if (this.state.cellType === 's2') {
      if (!this.selectS2Cell(point, px)) {
        this.selectZxyCell(point, px);
      }
    } else if (this.state.cellType === 'z/x/y') {
      if (!this.selectZxyCell(point, px)) {
        this.selectS2Cell(point, px);
      }
    } else {
      checkExhaustive(this.state.cellType);
    }
  }

  private selectS2Cell(point: S2LatLng, px: [number, number]): boolean {
    const cell = S2CellId.fromLatLng(point);
    let level = cell.level();
    while (level >= 0 && !this.layer.s2Cells.has(cell.parentAtLevel(level).toToken())) {
      level -= 1;
    }

    if (level >= 0) {
      this.updateState({
        ...this.state,
        selectedS2: {
          cell: cell.parentAtLevel(level),
          clickPx: px,
        },
        selectedZxy: undefined,
      });
      return true;
    } else {
      this.updateState({
        ...this.state,
        selectedS2: undefined,
        selectedZxy: undefined,
      });
      return false;
    }
  }

  private selectZxyCell(point: S2LatLng, px: [number, number]): boolean {
    let z = MAX_ZXY_ZOOM;
    let [x, y] = latLngToXyTile(point, z);
    while (z >= 0 && !this.layer.zxys.has(`${z}/${x}/${y}`)) {
      z -= 1;
      x = Math.floor(x / 2);
      y = Math.floor(y / 2);
    }

    if (z >= 0) {
      const llr = xyzToLlr(x, y, z);
      this.updateState({
        ...this.state,
        selectedZxy: {
          clickPx: px,
          llr,
          token: `${z}/${x}/${y}`,
          xyz: [x, y, z],
        },
        selectedS2: undefined,
      });
      return true;
    } else {
      this.updateState({
        ...this.state,
        selectedS2: undefined,
        selectedZxy: undefined,
      });
      return false;
    }
  }

  toggleCell(point: S2LatLng, currentZoom: number): void {
    if (this.state.cellType === 's2') {
      this.toggleS2Cell(point, currentZoom);
    } else if (this.state.cellType === 'z/x/y') {
      this.toggleZxyCell(point, currentZoom);
    } else {
      checkExhaustive(this.state.cellType);
    }
  }

  private toggleS2Cell(point: S2LatLng, currentZoom: number): void {
    const level = this.state.level === ZOOM_LEVEL ? currentZoom : this.state.level;
    const cell = S2CellId.fromLatLng(point).parentAtLevel(level);
    const id = cell.id().toString();
    const token = cell.toToken();
    if (this.layer.s2Cells.has(token)) {
      this.layer.s2Cells.delete(token);

      this.updateState({
        ...this.state,
        cellInput:
            // Progressively get more aggressive in removing it
            this.state.cellInput
                .replace(new RegExp(`^(.+),${id}$`), '$1')
                .replace(new RegExp(`^(.+,)?${id}(?:,(.+))?$`), '$1$2')
                .replace(new RegExp(`^(.+),${token}$`), '$1')
                .replace(new RegExp(`^(.+,)?${token}(?:,(.+))?$`), '$1$2'),
      });
    } else {
      this.layer.s2Cells.set(token, cell.toLoop(cell.level()));

      if (this.state.cellInput.trim() === '') {
        this.updateState({
          ...this.state,
          cellInput: token,
        });
      } else {
        this.updateState({
          ...this.state,
          cellInput: this.state.cellInput + ',' + token,
        });
      }
    }

    this.layerUpdated();
  }

  private toggleZxyCell(point: S2LatLng, currentZoom: number): void {
    const clampZoom = Math.min(Math.ceil(currentZoom), MAX_ZXY_ZOOM);
    const z = this.state.level === ZOOM_LEVEL ? clampZoom : this.state.level;
    const [x, y] = latLngToXyTile(point, z);
    const token = `${z}/${x}/${y}`;
    if (this.layer.zxys.has(token)) {
      this.layer.zxys.delete(token);
    } else {
      this.layer.zxys.set(token, [z, x, y]);
    }

    if (this.state.cellInput.trim() === '') {
      this.updateState({
        ...this.state,
        cellInput: token,
      });
    } else {
      this.updateState({
        ...this.state,
        cellInput: this.state.cellInput + ',' + token,
      });
    }

    this.layerUpdated();
  }

  private layerUpdated() {
    this.updateState({
      ...this.state,
      selectedS2: undefined,
      selectedZxy: undefined,
    });
    this.lastChange = Date.now();
  }
}

class CellLayer extends Layer {

  private readonly glBuffer: WebGLBuffer;
  readonly s2Cells: Map<string, S2Loop>;
  readonly zxys: Map<string, [number, number, number]>;

  constructor(
      private readonly controller: ViewerController,
      private readonly renderer: Renderer,
  ) {
    super(/* copyright= */ undefined);
    this.glBuffer = renderer.createDataBuffer(0);
    this.s2Cells = new Map<string, S2Loop>();
    this.zxys = new Map<string, [number, number, number]>();
  }

  click(point: Vec2, px: [number, number], contextual: boolean, source: MapController): boolean {
    if (contextual) {
      this.controller.selectCell(unprojectS2LatLng(point[0], point[1]), px);
    } else {
      this.controller.toggleCell(unprojectS2LatLng(point[0], point[1]), source.camera.zoom);
    }
    return true;
  }

  hasDataNewerThan(time: number): boolean {
    return this.controller.lastChange > time;
  }

  render(planner: Planner): void {
    const geometry = new ArrayBuffer(16384);
    let offset = 0;
    const drawables = [];
    for (const loop of this.s2Cells.values()) {
      const {splits, vertices} = projectS2Loop(loop);
      let last = 0;
      for (const i of splits) {
        // TODO(april): make this a polygon?
        const connected = new Float32Array(i - last + 2);
        connected.set(vertices.subarray(last, last + i - last), 0);
        connected[i - last + 0] = connected[0];
        connected[i - last + 1] = connected[1];

        const {byteSize, drawable} =
            this.renderer.lineProgram.plan(
                CELL_BORDER,
                CELL_BORDER,
                1,
                false,
                Z_USER_DATA,
                connected,
                geometry,
                offset,
                this.glBuffer,
            );
        offset += byteSize;
        drawables.push(drawable);
        last = i;
      }
    }

    for (const [z, x, y] of this.zxys.values()) {
      const halfWorldSize = Math.pow(2, z - 1);
      const vertices = new Float32Array([
        (x + 0) / halfWorldSize - 1, 1 - (y + 0) / halfWorldSize,
        (x + 1) / halfWorldSize - 1, 1 - (y + 0) / halfWorldSize,
        (x + 1) / halfWorldSize - 1, 1 - (y + 1) / halfWorldSize,
        (x + 0) / halfWorldSize - 1, 1 - (y + 1) / halfWorldSize,
        (x + 0) / halfWorldSize - 1, 1 - (y + 0) / halfWorldSize,
      ]);
      const {byteSize, drawable} =
          this.renderer.lineProgram.plan(
              CELL_BORDER,
              CELL_BORDER,
              1,
              false,
              Z_USER_DATA,
              vertices,
              geometry,
              offset,
              this.glBuffer,
          );
      offset += byteSize;
      drawables.push(drawable);
    }

    this.renderer.uploadData(geometry, offset, this.glBuffer, this.renderer.gl.STREAM_DRAW);
    planner.add(drawables);
  }
}

function latLngToXyTile(ll: S2LatLng, z: number): [number, number] {
  const worldSize = Math.pow(2, z);
  const scale = 0.5 / Math.PI * worldSize;
  return [
    Math.floor(scale * (ll.lngRadians() + Math.PI)),
    Math.floor(scale * (Math.PI - Math.log(Math.tan(Math.PI / 4 + ll.latRadians() / 2)))),
  ];
}

function xyzToLlr(x: number, y: number, z: number): S2LatLngRect {
  const halfWorldSize = Math.pow(2, z - 1);
  return S2LatLngRect.fromPointPair(
      unprojectS2LatLng((x + 0) / halfWorldSize - 1, 1 - (y + 0) / halfWorldSize),
      unprojectS2LatLng((x + 1) / halfWorldSize - 1, 1 - (y + 1) / halfWorldSize));
}
