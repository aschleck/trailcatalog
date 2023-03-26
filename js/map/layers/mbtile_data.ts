import { checkArgument, checkExists } from 'js/common/asserts';
import { HashMap } from 'js/common/collections';
import { debugMode } from 'js/common/debug';
import { LittleEndianView } from 'js/common/little_endian_view';

import { rgbaToUint32 } from '../common/math';
import { TileId, Vec2, VectorTileset } from '../common/types';
import { Layer } from '../layer';
import { Camera, projectE7Array } from '../models/camera';
import { Line } from '../rendering/geometry';
import { RenderPlanner } from '../rendering/render_planner';
import { Renderer } from '../rendering/renderer';

import { TileDataService } from './tile_data_service';
import { MAPTILER_CONTOURS } from './tile_sources';

const FILL = rgbaToUint32(0, 0, 0, 0.5);
const STROKE = rgbaToUint32(0.5, 0.5, 0.5, 0);
const TEXT_DECODER = new TextDecoder();

interface Feature {
  type: number;
  tags: number[];
  geometry: number[];
  starts: number[];
}

interface Geometry {
  lines: Array<Line & {
    nthLine: number;
  }>;
}

export class MbtileData extends Layer {

  private lastChange: number;
  private readonly tiles: HashMap<TileId, Geometry>;

  constructor(
      private readonly camera: Camera,
      private readonly dataService: TileDataService,
      private readonly renderer: Renderer) {
    super();
    this.lastChange = Date.now();
    this.tiles = new HashMap(id => `${id.x},${id.y},${id.zoom}`);

    this.registerDisposable(this.dataService.streamVectors(MAPTILER_CONTOURS, this));
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
    for (const [id, geometry] of sorted) {
      for (const line of geometry.lines) {
        if (line.nthLine % 1 === 0) {
          lines.push(line);
        }
      }
    }
    planner.addLines(lines, 2, 20, /* replace= */ false, /* round= */ false);
  }

  viewportBoundsChanged(viewportSize: Vec2, zoom: number): void {
    // TODO: we don't need to do this because another layer already does it, shady!
    // We could debounce it but that feels odd...
    // this.dataService.updateViewport(this.camera.centerPixel, viewportSize, zoom);
  }

  loadTile(id: TileId, buffer: ArrayBuffer): void {
    this.lastChange = Date.now();

    const data = new LittleEndianView(buffer);
    const geometry: Geometry = {
      lines: [],
    };
    while (data.hasRemaining()) {
      const tag = data.getInt8();
      const wireType = tag & 0x7;
      const field = tag >> 3;

      if (wireType === 2) {
        const size = data.getVarInt32();
        const embedded = data.viewSlice(size);
        if (field === 3) {
          const {lines} = loadLayer(id, embedded);
          geometry.lines.push(...lines);
        }
      } else {
        throw new Error(`Unknown wire type ${wireType} for field ${field}`);
      }
    }
    this.tiles.set(id, geometry);
  }

  unloadTiles(ids: TileId[]): void {
    for (const id of ids) {
      this.tiles.delete(id);
    }
    this.lastChange = Date.now();
  }
}

function loadLayer(id: TileId, data: LittleEndianView): Geometry {
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

  return project(id, name, keys, values, features, extent);
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

function project(
    id: TileId,
    name: string,
    keys: string[],
    values: Array<boolean|number|string>,
    features: Feature[],
    extent: number): Geometry {
  const halfWorldSize = Math.pow(2, id.zoom - 1);
  const tx = id.x / halfWorldSize;
  const ty = (id.y - 1) / halfWorldSize;
  const increment = 1 / halfWorldSize / extent;
  const lines = [];
  for (const {geometry, tags, starts} of features) {
    let nthLine = 1;
    for (let i = 0; i < tags.length; i += 2) {
      if (keys[tags[i]] === 'nth_line') {
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

      lines.push({
        colorFill: FILL,
        colorStroke: STROKE,
        nthLine,
        stipple: false,
        vertices,
      });
      cursor = end;
    }
  }
  return {lines};
}
