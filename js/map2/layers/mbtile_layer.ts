import { S2LatLngRect } from 'java/org/trailcatalog/s2';
import { checkExhaustive } from 'js/common/asserts';
import { HashMap, HashSet } from 'js/common/collections';
import { Debouncer } from 'js/common/debouncer';
import { WorkerPool } from 'js/common/worker_pool';

import { Copyright, RgbaU32, TileId } from '../common/types';
import { Layer } from '../layer';
import { Planner } from '../rendering/planner';
import { Drawable } from '../rendering/program';
import { Renderer } from '../rendering/renderer';
import { LoadResponse, Request as LoaderRequest, Response as LoaderResponse, Style } from '../workers/mbtile_loader';
import { Command as FetcherCommand, LoadTileCommand, Request as FetcherRequest, UnloadTilesCommand } from '../workers/xyz_data_fetcher';
import { Z_BASE_TILE } from '../z';

interface LoadedTile {
  drawables: Drawable[];
  glGeometryBuffer: WebGLBuffer;
  glIndexBuffer: WebGLBuffer;
}

export const NATURE: Readonly<Style> = {
  polygons: [
    // Land
    {
      filters: [{match: 'string_equals', key: 'class', value: 'beach'}],
      fill: 0x5D543EFF as RgbaU32,
      z: Z_BASE_TILE + 1,
    },
    {
      filters: [{match: 'string_equals', key: 'class', value: 'rock'}],
      fill: 0xD0D0D0FF as RgbaU32,
      z: Z_BASE_TILE + 1,
    },
    {
      filters: [{match: 'string_equals', key: 'class', value: 'sand'}],
      fill: 0x5D543EFF as RgbaU32,
      z: Z_BASE_TILE + 1,
    },
    {
      filters: [{match: 'string_equals', key: 'class', value: 'forest'}],
      fill: 0x5D543EFF as RgbaU32,
      z: Z_BASE_TILE + 1,
    },
    {
      filters: [{match: 'string_equals', key: 'class', value: 'grass'}],
      fill: 0x5D543EFF as RgbaU32,
      z: Z_BASE_TILE + 1,
    },
    // Citylike
    {
      filters: [{match: 'string_equals', key: 'class', value: 'bridge'}],
      fill: 0x5D543EFF as RgbaU32,
      z: Z_BASE_TILE + 1,
    },
    {
      filters: [{match: 'string_equals', key: 'class', value: 'pier'}],
      fill: 0x5D543EFF as RgbaU32,
      z: Z_BASE_TILE + 1,
    },
    {
      filters: [{match: 'string_equals', key: 'class', value: 'residential'}],
      fill: 0x5D543EFF as RgbaU32,
      z: Z_BASE_TILE + 1,
    },
    // Cultivation
    {
      filters: [{match: 'string_equals', key: 'class', value: 'crop'}],
      fill: 0x5D543EFF as RgbaU32,
      z: Z_BASE_TILE + 1,
    },
    {
      filters: [{match: 'string_equals', key: 'class', value: 'farmland'}],
      fill: 0x5D543EFF as RgbaU32,
      z: Z_BASE_TILE + 1,
    },
    {
      filters: [{match: 'string_equals', key: 'class', value: 'grass'}],
      fill: 0x5D543EFF as RgbaU32,
      z: Z_BASE_TILE + 1,
    },
    // Protected
    {
      filters: [{match: 'string_equals', key: 'class', value: 'city_park'}],
      fill: 0x5D543EFF as RgbaU32,
      z: Z_BASE_TILE + 1,
    },
    {
      filters: [{match: 'string_equals', key: 'class', value: 'county_park'}],
      fill: 0x5D543EFF as RgbaU32,
      z: Z_BASE_TILE + 1,
    },
    {
      filters: [{match: 'string_equals', key: 'class', value: 'ecological_reserve'}],
      fill: 0x5D543EFF as RgbaU32,
      z: Z_BASE_TILE + 1,
    },
    {
      filters: [{match: 'string_equals', key: 'class', value: 'habitat_preserve'}],
      fill: 0x5D543EFF as RgbaU32,
      z: Z_BASE_TILE + 1,
    },
    {
      filters: [{match: 'string_equals', key: 'class', value: 'national_forest'}],
      fill: 0x5D543EFF as RgbaU32,
      z: Z_BASE_TILE + 1,
    },
    {
      filters: [{match: 'string_equals', key: 'class', value: 'national_monument'}],
      fill: 0x5D543EFF as RgbaU32,
      z: Z_BASE_TILE + 1,
    },
    {
      filters: [{match: 'string_equals', key: 'class', value: 'national_park'}],
      fill: 0x5D543EFF as RgbaU32,
      z: Z_BASE_TILE + 1,
    },
    {
      filters: [{match: 'string_equals', key: 'class', value: 'national_recreation_area'}],
      fill: 0x5D543EFF as RgbaU32,
      z: Z_BASE_TILE + 1,
    },
    {
      filters: [{match: 'string_equals', key: 'class', value: 'national_recreational_area'}],
      fill: 0x5D543EFF as RgbaU32,
      z: Z_BASE_TILE + 1,
    },
    {
      filters: [{match: 'string_equals', key: 'class', value: 'national_wildlife_refuge'}],
      fill: 0x5D543EFF as RgbaU32,
      z: Z_BASE_TILE + 1,
    },
    {
      filters: [{match: 'string_equals', key: 'class', value: 'natural_preserve'}],
      fill: 0x5D543EFF as RgbaU32,
      z: Z_BASE_TILE + 1,
    },
    {
      filters: [{match: 'string_equals', key: 'class', value: 'nature_preserve'}],
      fill: 0x5D543EFF as RgbaU32,
      z: Z_BASE_TILE + 1,
    },
    {
      filters: [{match: 'string_equals', key: 'class', value: 'nature_reserve'}],
      fill: 0x5D543EFF as RgbaU32,
      z: Z_BASE_TILE + 1,
    },
    {
      filters: [{match: 'string_equals', key: 'class', value: 'open_space'}],
      fill: 0x5D543EFF as RgbaU32,
      z: Z_BASE_TILE + 1,
    },
    {
      filters: [{match: 'string_equals', key: 'class', value: 'open_space_preserve'}],
      fill: 0x5D543EFF as RgbaU32,
      z: Z_BASE_TILE + 1,
    },
    {
      filters: [{match: 'string_equals', key: 'class', value: 'protected_area'}],
      fill: 0x5D543EFF as RgbaU32,
      z: Z_BASE_TILE + 1,
    },
    {
      filters: [{match: 'string_equals', key: 'class', value: 'protected_land'}],
      fill: 0x5D543EFF as RgbaU32,
      z: Z_BASE_TILE + 1,
    },
    {
      filters: [{match: 'string_equals', key: 'class', value: 'regional_park'}],
      fill: 0x5D543EFF as RgbaU32,
      z: Z_BASE_TILE + 1,
    },
    {
      filters: [{match: 'string_equals', key: 'class', value: 'regional_preserve'}],
      fill: 0x5D543EFF as RgbaU32,
      z: Z_BASE_TILE + 1,
    },
    {
      filters: [{match: 'string_equals', key: 'class', value: 'state_park'}],
      fill: 0x5D543EFF as RgbaU32,
      z: Z_BASE_TILE + 1,
    },
    {
      filters: [{match: 'string_equals', key: 'class', value: 'state_wilderness'}],
      fill: 0x5D543EFF as RgbaU32,
      z: Z_BASE_TILE + 1,
    },
    {
      filters: [{match: 'string_equals', key: 'class', value: 'wilderness_area'}],
      fill: 0x5D543EFF as RgbaU32,
      z: Z_BASE_TILE + 1,
    },
    {
      filters: [{match: 'string_equals', key: 'class', value: 'wilderness_study_area'}],
      fill: 0x5D543EFF as RgbaU32,
      z: Z_BASE_TILE + 1,
    },
    {
      filters: [{match: 'string_equals', key: 'class', value: 'wildlife_area'}],
      fill: 0x5D543EFF as RgbaU32,
      z: Z_BASE_TILE + 1,
    },
    // Nature-y?
    {
      filters: [{match: 'string_equals', key: 'class', value: 'scrub'}],
      fill: 0x5D543EFF as RgbaU32,
      z: Z_BASE_TILE + 1,
    },
    {
      filters: [{match: 'string_equals', key: 'class', value: 'tree'}],
      fill: 0x5D543EFF as RgbaU32,
      z: Z_BASE_TILE + 1,
    },
    {
      filters: [{match: 'string_equals', key: 'class', value: 'wood'}],
      fill: 0x5D543EFF as RgbaU32,
      z: Z_BASE_TILE + 1,
    },
    // Water
    {
      filters: [{match: 'string_equals', key: 'class', value: 'lake'}],
      fill: 0x1D354EFF as RgbaU32,
      z: Z_BASE_TILE + 1,
    },
    {
      filters: [{match: 'string_equals', key: 'class', value: 'national_marine_sanctuary'}],
      fill: 0x1D354EFF as RgbaU32,
      z: Z_BASE_TILE + 1,
    },
    {
      filters: [{match: 'string_equals', key: 'class', value: 'ocean'}],
      fill: 0x1D354EFF as RgbaU32,
      z: Z_BASE_TILE + 1,
    },
    {
      filters: [{match: 'string_equals', key: 'class', value: 'river'}],
      fill: 0x1D354EFF as RgbaU32,
      z: Z_BASE_TILE + 1,
    },
    {
      filters: [{match: 'string_equals', key: 'class', value: 'state_marine_conservation_area'}],
      fill: 0x1D354EFF as RgbaU32,
      z: Z_BASE_TILE + 1,
    },
    {
      filters: [{match: 'string_equals', key: 'class', value: 'state_marine_reserve'}],
      fill: 0x1D354EFF as RgbaU32,
      z: Z_BASE_TILE + 1,
    },
    {
      filters: [{match: 'string_equals', key: 'class', value: 'water'}],
      fill: 0x1D354EFF as RgbaU32,
      z: Z_BASE_TILE + 1,
    },
    {
      filters: [{match: 'string_equals', key: 'class', value: 'wetland'}],
      fill: 0x1D354EFF as RgbaU32,
      z: Z_BASE_TILE + 1,
    },
  ],
};

export class MbtileLayer extends Layer {

  private readonly fetcher: Worker;
  private readonly loader: WorkerPool<LoaderRequest, LoaderResponse>;
  private readonly tiles: HashMap<TileId, LoadedTile|undefined>;
  private generation: number;
  private lastRenderGeneration: number;

  constructor(
      copyrights: Copyright[],
      url: string,
      style: Style,
      extraZoom: number,
      minZoom: number,
      maxZoom: number,
      private readonly renderer: Renderer,
  ) {
    super(copyrights);
    this.fetcher = new Worker('/static/xyz_data_fetcher_worker.js');
    this.loader = new WorkerPool('/static/mbtile_loader_worker.js', 1);
    this.tiles = new HashMap(id => `${id.zoom},${id.x},${id.y}`);
    this.registerDisposer(() => {
      for (const response of this.tiles.values()) {
        if (!response) {
          continue;
        }

        this.renderer.deleteBuffer(response.glGeometryBuffer);
        this.renderer.deleteBuffer(response.glIndexBuffer);
      }
    });
    this.generation = 0;
    this.lastRenderGeneration = -1;

    this.fetcher.onmessage = e => {
      const command = e.data as FetcherCommand;
      if (command.kind === 'ltc') {
        this.loadRawTile(command);
      } else if (command.kind === 'utc') {
        this.unloadTiles(command);
      } else {
        checkExhaustive(command);
      }
    };

    this.loader.onresponse = response => {
      if (response.kind === 'lr') {
        this.loadProcessedTile(response);
      } else {
        checkExhaustive(response.kind);
      }
    };

    this.postFetcherRequest({
      kind: 'ir',
      url,
      extraZoom,
      minZoom,
      maxZoom,
    });
    this.loader.broadcast({
      kind: 'ir',
      style,
    });
  }

  hasNewData(): boolean {
    return this.generation !== this.lastRenderGeneration;
  }

  render(planner: Planner): void {
    for (const response of this.tiles.values()) {
      if (!response) {
        continue;
      }

      planner.add(response.drawables);
      this.lastRenderGeneration = this.generation;
    }
  }

  viewportChanged(bounds: S2LatLngRect, zoom: number): void {
    const lat = bounds.lat();
    const lng = bounds.lng();
    this.postFetcherRequest({
      kind: 'uvr',
      viewport: {
        lat: [lat.lo(), lat.hi()],
        lng: [lng.lo(), lng.hi()],
        zoom,
      },
    });
  }

  private loadRawTile(command: LoadTileCommand): void {
    if (command.data.byteLength === 0) {
      return;
    }

    this.tiles.set(command.id, undefined);
    this.loader.post({
      kind: 'lr',
      id: command.id,
      data: command.data,
    }, [command.data]);
  }

  private loadProcessedTile(response: LoadResponse): void {
    // Has this already been unloaded?
    if (!this.tiles.has(response.id)) {
      return;
    }

    //console.log(response);

    const geometry = this.renderer.createDataBuffer(response.geometry.byteLength);
    const index = this.renderer.createIndexBuffer(response.index.byteLength);
    this.renderer.uploadData(response.geometry, response.geometry.byteLength, geometry);
    this.renderer.uploadIndices(response.index, response.index.byteLength, index);
    const drawables = [];

    for (const polygon of response.polygonalGeometries) {
      drawables.push({
        elements: {
          count: polygon.indexCount,
          index,
          offset: polygon.indexOffset,
        },
        geometry,
        geometryByteLength: polygon.geometryByteLength,
        geometryOffset: polygon.geometryOffset,
        instanced: undefined,
        program: this.renderer.triangleProgram,
        texture: undefined,
        vertexCount: undefined,
        z: polygon.z,
      });
    }

    this.tiles.set(response.id, {
      glGeometryBuffer: geometry,
      glIndexBuffer: index,
      drawables,
    });
    this.generation += 1;
  }

  private unloadTiles(command: UnloadTilesCommand): void {
    for (const id of command.ids) {
      const response = this.tiles.get(id);
      if (response) {
        this.tiles.delete(id);
        this.renderer.deleteBuffer(response.glGeometryBuffer);
        this.renderer.deleteBuffer(response.glIndexBuffer);
      }
    }
    this.generation += 1;
  }

  private postFetcherRequest(request: FetcherRequest, transfer?: Transferable[]) {
    this.fetcher.postMessage(request, transfer ?? []);
  }
}

