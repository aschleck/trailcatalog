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
import { Z_BASE_TERRAIN, Z_BASE_WATER, Z_OVERLAY_TRANSPORTATION } from '../z';

interface LoadedTile {
  drawables: Drawable[];
  glGeometryBuffer: WebGLBuffer;
  glIndexBuffer: WebGLBuffer;
}

export const NATURE: Readonly<Style> = {
  layers: [
    {
      layerName: 'globallandcover',
      lines: [],
      polygons: [
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              'crop',
              'grass',
              'scrub',
            ],
          }],
          fill: 0x6fd19588 as RgbaU32,
          z: Z_BASE_TERRAIN + 0.01,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              'forest',
              'tree',
            ],
          }],
          fill: 0x21ad5788 as RgbaU32,
          z: Z_BASE_TERRAIN,
        },
        //{
        //  filters: [{
        //    match: 'string_in',
        //    key: 'class',
        //    value: [
        //      'snow',
        //    ],
        //  }],
        //  fill: 0xFFFFFFFFF as RgbaU32,
        //  z: Z_BASE_TERRAIN,
        //},
      ],
    },
    {
      layerName: 'landcover',
      lines: [],
      polygons: [
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              'grass',
              'wood',
            ],
          }],
          fill: 0x21AD57AA as RgbaU32,
          z: Z_BASE_TERRAIN + 0.5,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              'sand',
              'state_beach',
            ],
          }],
          fill: 0xf5e1bccc as RgbaU32,
          z: Z_BASE_TERRAIN + 0.5,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              'ice',
            ],
          }],
          fill: 0xFFFFFFFFF as RgbaU32,
          z: Z_BASE_TERRAIN + 0.5,
        },
      ],
    },
    {
      layerName: 'park',
      lines: [],
      polygons: [
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              'city_park',
              'county_park',
              'national_park',
              'nature_reserve',
              'open_space_preserve',
              'regional_park',
              'state_park',
              'state_wilderness',
            ],
          }],
          fill: 0x21ad57aa as RgbaU32,
          z: Z_BASE_TERRAIN + 0.75,
        },
      ],
    },
    {
      layerName: 'transportation',
      lines: [
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              'runway',
              'taxiway',
            ],
          }],
          fill: 0xFFFFFFFF as RgbaU32,
          stroke: 0xFFFFFFFF as RgbaU32,
          radius: 1,
          stipple: false,
          z: Z_OVERLAY_TRANSPORTATION,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              'rail',
            ],
          }],
          fill: 0xAAAAAAAA as RgbaU32,
          stroke: 0xAAAAAAAA as RgbaU32,
          radius: 1,
          stipple: false,
          z: Z_OVERLAY_TRANSPORTATION,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              'minor',
              'minor_construction',
              'service',
              'tertiary',
            ],
          }],
          fill: 0xFFFFFFFF as RgbaU32,
          stroke: 0xFFFFFFFF as RgbaU32,
          radius: 0.75,
          stipple: false,
          z: Z_OVERLAY_TRANSPORTATION,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              'primary',
              'primary_construction',
              'secondary',
              'secondary_construction',
            ],
          }],
          fill: 0xFFFFFFFF as RgbaU32,
          stroke: 0xFFFFFFFF as RgbaU32,
          radius: 1.5,
          stipple: false,
          z: Z_OVERLAY_TRANSPORTATION,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              'motorway',
              'motorway_construction',
              'trunk',
            ],
          }],
          fill: 0xFFFFFFFF as RgbaU32,
          stroke: 0xFFFFFFFF as RgbaU32,
          radius: 1.5,
          stipple: false,
          z: Z_OVERLAY_TRANSPORTATION,
        },
      ],
      polygons: [],
    },
    {
      layerName: 'water',
      lines: [
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              'drain',
              'lake',
              'river',
              'stream',
            ],
          }],
          fill: 0x52BAEBFF as RgbaU32,
          stroke: 0x52BAEBFF as RgbaU32,
          radius: 1,
          stipple: false,
          z: Z_BASE_WATER,
        },
      ],
      polygons: [
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              'lake',
              'ocean',
              'river',
              'swimming_pool',
            ],
          }],
          fill: 0x52BAEBFF as RgbaU32,
          z: Z_BASE_WATER,
        },
      ],
    },
    {
      layerName: 'waterway',
      lines: [
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              'river',
              'stream',
            ],
          }],
          fill: 0x52BAEBFF as RgbaU32,
          stroke: 0x52BAEBFF as RgbaU32,
          radius: 1,
          stipple: false,
          z: Z_BASE_WATER,
        },
      ],
      polygons: [],
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

    for (const line of response.lines) {
      drawables.push({
        elements: undefined,
        geometry,
        geometryByteLength: line.geometryByteLength,
        geometryOffset: line.geometryOffset,
        instanced: {
          count: line.instanceCount
        },
        program: this.renderer.lineProgram,
        texture: undefined,
        vertexCount: line.vertexCount,
        z: line.z,
      });
    }

    for (const polygon of response.polygons) {
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

