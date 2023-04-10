import { checkArgument, checkExists } from 'js/common/asserts';
import { HashMap } from 'js/common/collections';
import { debugMode } from 'js/common/debug';
import { LittleEndianView } from 'js/common/little_endian_view';
import { getUnitSystem, UnitSystem } from 'js/server/ssr_aware';

import { rgbaToUint32 } from '../common/math';
import { TileId, Vec2, VectorTileset } from '../common/types';
import { Layer } from '../layer';
import { Camera, projectE7Array } from '../models/camera';
import { Line } from '../rendering/geometry';
import { RenderPlanner } from '../rendering/render_planner';
import { Renderer } from '../rendering/renderer';
import { SdfPlanner } from '../rendering/sdf_planner';

import { TileDataService } from './tile_data_service';

const CONTOUR_FILL = rgbaToUint32(0, 0, 0, 0.5);
const CONTOUR_STROKE = rgbaToUint32(0, 0, 0, 0.5);
const CONTOUR_NORMAL_WIDTH = 0.75;
const CONTOUR_EMPHASIZED_WIDTH = 1.5;
const CONTOUR_LABEL_EVERY = 0.000007;
const CONTOUR_LABEL_FILL = rgbaToUint32(0, 0, 0, 1);
const CONTOUR_LABEL_STROKE = rgbaToUint32(1, 1, 1, 1);

const TEXT_DECODER = new TextDecoder();

interface Feature {
  type: number;
  tags: number[];
  geometry: number[];
  starts: number[];
}

interface Tile {
  contours: Contours[];
}

interface Contours {
  unit: UnitSystem;
  lines: Array<Line & {
    height: number;
    labels: Label[];
    nthLine: number;
  }>;
}

interface Label {
  angle: number;
  position: Vec2;
}

export class MbtileData extends Layer {

  private lastChange: number;
  private readonly tiles: HashMap<TileId, Tile>;
  private readonly sdfRenderer: SdfPlanner;

  constructor(
      private readonly camera: Camera,
      private readonly dataService: TileDataService,
      private readonly renderer: Renderer,
      tileset: VectorTileset,
  ) {
    super();
    this.lastChange = Date.now();
    this.tiles = new HashMap(id => `${id.x},${id.y},${id.zoom}`);
    this.sdfRenderer = new SdfPlanner(renderer);
    this.registerDisposable(this.sdfRenderer);

    this.registerDisposable(this.dataService.streamVectors(tileset, this));
  }

  hasDataNewerThan(time: number): boolean {
    return this.lastChange > time;
  }

  plan(viewportSize: Vec2, zoom: number, planner: RenderPlanner): void {
    if (zoom < 11) {
      return;
    }

    const sorted = [...this.tiles].sort((a, b) => a[0].zoom - b[0].zoom);
    const lines = [];
    const boldLines = [];
    const unit = getUnitSystem();
    for (const [id, tile] of sorted) {
      for (const geometry of tile.contours) {
        if (geometry.unit !== unit) {
          continue;
        }

        for (const line of geometry.lines) {
          if ((zoom >= 14 && line.nthLine % 5 === 0) || line.nthLine % 10 === 0) {
            if (zoom >= 17) {
              boldLines.push(line);
            } else {
              lines.push(line);
            }

            for (let i = 0; i < line.labels.length; ++i) {
              const by2 = i % 2;
              const by3 = i % 3;
              const by5 = i % 5;
              const by7 = i % 7;
              if (zoom < 15.5) {
                continue;
              } else if (zoom < 17 && by2 > 0) {
                continue;
              } else if (zoom < 18 && by3 > 0) {
                continue;
              } else if (zoom < 19 && by5 > 0) {
                continue;
              }

              const label = line.labels[i];
              this.sdfRenderer.plan(
                String(line.height),
                CONTOUR_LABEL_FILL,
                CONTOUR_LABEL_STROKE,
                0.5,
                label.position,
                [0, 0],
                label.angle,
                planner);
            }
          } else if (zoom >= 17) {
            lines.push(line);
          }
        }
      }
    }
    planner.addLines(
        boldLines, CONTOUR_EMPHASIZED_WIDTH, 10, /* replace= */ false, /* round= */ false);
    planner.addLines(lines, CONTOUR_NORMAL_WIDTH, 10, /* replace= */ false, /* round= */ false);
  }

  viewportBoundsChanged(viewportSize: Vec2, zoom: number): void {
    // TODO: we don't need to do this because another layer already does it, shady!
    // We could debounce it but that feels odd...
    // this.dataService.updateViewport(this.camera.centerPixel, viewportSize, zoom);
  }

  loadTile(id: TileId, buffer: ArrayBuffer): void {
    this.lastChange = Date.now();

    const data = new LittleEndianView(buffer);
    const tile: Tile = {
      contours: [],
    };
    while (data.hasRemaining()) {
      const tag = data.getInt8();
      const wireType = tag & 0x7;
      const field = tag >> 3;

      if (wireType === 2) {
        const size = data.getVarInt32();
        const embedded = data.viewSlice(size);
        if (field === 3) {
          loadLayer(id, embedded, tile);
        }
      } else {
        throw new Error(`Unknown wire type ${wireType} for field ${field}`);
      }
    }
    this.tiles.set(id, tile);
  }

  unloadTiles(ids: TileId[]): void {
    for (const id of ids) {
      this.tiles.delete(id);
    }
    this.lastChange = Date.now();
  }
}

function loadLayer(id: TileId, data: LittleEndianView, tile: Tile): void {
  let version;
  let name = '';
  let extent = 4096;
  const keys = [];
  const values = [];
  const features = [];
  while (data.hasRemaining()) {
    const tag = data.getInt8();
    const wireType = tag & 0x7;
    const field = tag >> 3;

    if (wireType === 0) {
      const value = data.getVarInt32();
      if (field === 5) {
        extent = value;
      } else if (field === 15) {
        version = value;
      }
    } else if (wireType === 2) {
      const size = data.getVarInt32();
      if (field === 1) {
        name = TEXT_DECODER.decode(data.sliceInt8(size));
      } else if (field === 2) {
        features.push(loadFeature(data.viewSlice(size)));
      } else if (field === 3) {
        keys.push(TEXT_DECODER.decode(data.sliceInt8(size)));
      } else if (field === 4) {
        values.push(loadValue(data.viewSlice(size)));
      } else {
        const embedded = data.viewSlice(size);
      }
    } else {
      throw new Error(`Unknown wire type ${wireType} for field ${field}`);
    }
  }

  if (name === 'contour' || name === 'contour_ft') {
    const unit = name === 'contour' ? 'metric' : 'imperial'
    tile.contours.push(projectContours(id, unit, keys, values, features, extent));
  } else {
    console.log(name);
  }
}

function loadFeature(data: LittleEndianView): Feature {
  let type;
  let tags;
  let geometry;
  let starts;
  while (data.hasRemaining()) {
    const tag = data.getInt8();
    const wireType = tag & 0x7;
    const field = tag >> 3;

    if (wireType === 0) {
      const value = data.getVarInt32();
      if (field === 3) {
        type = value;
      }
    } else if (wireType === 2) {
      const slice = data.viewSlice(data.getVarInt32());
      if (field === 2) {
        tags = loadPackedInt32s(slice);
      } else if (field === 4) {
        const result = decodeGeometry(loadPackedInt32s(slice));
        geometry = result.geometry;
        starts = result.starts;
      }
    } else {
      throw new Error(`Unknown wire type ${wireType} for field ${field}`);
    }
  }

  return {
    type: checkExists(type),
    tags: tags ?? [],
    geometry: checkExists(geometry),
    starts: checkExists(starts),
  };
}

function loadValue(data: LittleEndianView): boolean|number|string {
  let boolean;
  let number;
  let string;
  while (data.hasRemaining()) {
    const tag = data.getInt8();
    const wireType = tag & 0x7;
    const field = tag >> 3;

    if (wireType === 0) {
      const value = data.getVarInt32();
      if (field === 4 || field === 5) {
        number = value;
      } else if (field === 6) {
        number = deZigZag(value);
      } else if (field === 7) {
        boolean = !!value;
      }
    } else if (wireType === 2) {
      const size = data.getVarInt32();
      if (field === 1) {
        string = TEXT_DECODER.decode(data.sliceInt8(size));
      } else {
        throw new Error(`Unknown field ${field}`);
      }
    } else {
      throw new Error(`Unknown wire type ${wireType} for field ${field}`);
    }
  }

  return boolean ?? number ?? string ?? 0;
}

function decodeGeometry(data: number[]): {
  geometry: number[];
  starts: number[];
} {
  const cursor = [0, 0];
  const geometry: number[] = [];
  const starts: number[] = [];

  for (let i = 0; i < data.length; ) {
    const tag = data[i];
    i += 1;
    const command = tag & 0x7;
    const count = tag >> 3;
    if (command === 1) { // move to
      for (let j = 0; j < count; j += 1, i += 2) {
        starts.push(geometry.length);
        const x = cursor[0] + deZigZag(data[i + 0]);
        const y = cursor[1] + deZigZag(data[i + 1]);
        geometry.push(x, y);
        cursor[0] = x;
        cursor[1] = y;
      }
    } else if (command === 2) { // line to
      for (let j = 0; j < count; j += 1, i += 2) {
        const x = cursor[0] + deZigZag(data[i + 0]);
        const y = cursor[1] + deZigZag(data[i + 1]);
        geometry.push(x, y);
        cursor[0] = x;
        cursor[1] = y;
      }
    } else if (command === 7) { // close path
      checkArgument(count === 1);
      const last = starts[starts.length - 1];
      geometry.push(geometry[last + 0], geometry[last + 1]);
    } else {
      throw new Error(`Unknown command ${command}`);
    }
  }
  return {
    geometry,
    starts,
  };
}

function loadPackedInt32s(data: LittleEndianView): number[] {
  const values = [];
  while (data.hasRemaining()) {
    values.push(data.getVarInt32());
  }
  return values;
}

function deZigZag(u: number): number {
  return (u >>> 1) ^ -(u & 1);
}

function projectContours(
    id: TileId,
    unit: UnitSystem,
    keys: string[],
    values: Array<boolean|number|string>,
    features: Feature[],
    extent: number): Contours {
  const halfWorldSize = Math.pow(2, id.zoom - 1);
  const tx = id.x / halfWorldSize;
  const ty = (id.y - 1) / halfWorldSize;
  const increment = 1 / halfWorldSize / extent;
  const lines = [];
  for (const {geometry, tags, starts} of features) {
    let height = 0;
    let nthLine = 1;
    for (let i = 0; i < tags.length; i += 2) {
      if (keys[tags[i]] === 'height') {
        height = values[tags[i + 1]] as number;
      } else if (keys[tags[i]] === 'nth_line') {
        nthLine = values[tags[i + 1]] as number;
      }
    }

    starts.push(geometry.length);
    let cursor = starts[0];
    for (let i = 1; i < starts.length; ++i) {
      let end = starts[i];
      const vertices = new Float64Array(end - cursor);
      for (let j = cursor; j < end; j += 2) {
        vertices[j - cursor + 0] = tx + geometry[j + 0] * increment;
        vertices[j - cursor + 1] = ty + (extent - geometry[j + 1]) * increment;
      }

      const labels: Label[] = [];
      let distance = CONTOUR_LABEL_EVERY;
      for (let j = 0; j < vertices.length - 2; j += 2) {
        const dx = vertices[j + 0 + 2] - vertices[j + 0];
        const dy = vertices[j + 1 + 2] - vertices[j + 1];
        distance += Math.sqrt(dx * dx + dy * dy);

        if (distance >= CONTOUR_LABEL_EVERY) {
          const direction = Math.atan2(dx, dy);
          const angle = direction > 0 ? Math.PI / 2 - direction : 3 / 2 * Math.PI - direction;
          labels.push({
            angle,
            position: [vertices[j], vertices[j + 1]],
          });
          distance = 0;
        }
      }
      lines.push({
        colorFill: CONTOUR_FILL,
        colorStroke: CONTOUR_STROKE,
        height,
        labels,
        nthLine,
        stipple: false,
        vertices,
      });
      cursor = end;
    }
  }
  return {
    lines,
    unit,
  };
}
