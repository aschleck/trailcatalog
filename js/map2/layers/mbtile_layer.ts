import { S2LatLngRect } from 'java/org/trailcatalog/s2';
import { checkExhaustive } from 'js/common/asserts';
import { HashMap, HashSet } from 'js/common/collections';
import { QueuedWorkerPool, Task } from 'js/common/queued_worker_pool';
import { WorkerPool } from 'js/common/worker_pool';

import { Copyright, RgbaU32, TileId } from '../common/types';
import { Layer } from '../layer';
import { GLYPHER } from '../rendering/glypher';
import { Planner } from '../rendering/planner';
import { Drawable } from '../rendering/program';
import { Renderer } from '../rendering/renderer';
import { Label, LoadResponse, Request as LoaderRequest, Response as LoaderResponse, Style } from '../workers/mbtile_loader';
import { Command as FetcherCommand, LoadTileCommand, Request as FetcherRequest, UnloadTilesCommand } from '../workers/xyz_data_fetcher';
import { Z_BASE_TERRAIN, Z_BASE_WATER, Z_OVERLAY_TEXT, Z_OVERLAY_TRANSPORTATION } from '../z';

interface LoadedTile {
  drawables: Drawable[];
  glGeometryBuffer: WebGLBuffer;
  glIndexBuffer: WebGLBuffer;
  labels: Label[];
}

export const NATURE: Readonly<Style> = {
  layers: [
    {
      layerName: 'globallandcover',
      minZoom: 0,
      maxZoom: 31,
      lines: [],
      points: [],
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
          fill: 0x6fd1954C as RgbaU32,
          z: Z_BASE_TERRAIN + 0.2,
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
          fill: 0x21ad574C as RgbaU32,
          z: Z_BASE_TERRAIN + 0.1,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              'snow',
            ],
          }],
          fill: 0xFFFFFFF80 as RgbaU32,
          z: Z_BASE_TERRAIN + 0.1,
        },
      ],
    },
    {
      layerName: 'landcover',
      minZoom: 0,
      maxZoom: 31,
      lines: [],
      points: [],
      polygons: [
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              'wetland',
            ],
          }],
          fill: 0x6fd1954C as RgbaU32,
          z: Z_BASE_TERRAIN + 0.5,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              'grass',
              'wood',
            ],
          }],
          fill: 0x21AD574C as RgbaU32,
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
          fill: 0xFFFFFFF80 as RgbaU32,
          z: Z_BASE_TERRAIN + 0.5,
        },
      ],
    },
    {
      layerName: 'park',
      minZoom: 0,
      maxZoom: 31,
      lines: [],
      points: [],
      polygons: [
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              //'city_park',
              //'county_park',
              // TODO(april): this looks gross at the nortern tip of Greenland
              //'national_park',
              //'nature_reserve',
              //'open_space_preserve',
              //'regional_park',
              //'state_park',
              //'state_wilderness',
            ],
          }],
          fill: 0x21ad57aa as RgbaU32,
          z: Z_BASE_TERRAIN + 0.75,
        },
      ],
    },
    {
      layerName: 'place',
      minZoom: 0,
      maxZoom: 4,
      lines: [],
      points: [
        {
          filters: [
            {
              match: 'string_in',
              key: 'class',
              value: [
                'country',
              ],
            },
            {
              match: 'less_than',
              key: 'rank',
              value: 3,
            },
          ],
          textFill: 0x000000FF as RgbaU32,
          textStroke: 0xEFEFEFFF as RgbaU32,
          textScale: 0.5,
          z: Z_OVERLAY_TEXT,
        },
      ],
      polygons: [],
    },
    {
      layerName: 'place',
      minZoom: 4,
      maxZoom: 7,
      lines: [],
      points: [
        {
          filters: [
            {
              match: 'string_in',
              key: 'class',
              value: [
                'country',
              ],
            },
            {
              match: 'less_than',
              key: 'rank',
              value: 4,
            },
          ],
          textFill: 0x000000FF as RgbaU32,
          textStroke: 0xEFEFEFFF as RgbaU32,
          textScale: 0.5,
          z: Z_OVERLAY_TEXT + 0.1,
        },
        {
          filters: [
            {
              match: 'string_in',
              key: 'class',
              value: [
                'province',
                'state',
              ],
            },
            {
              match: 'less_than',
              key: 'rank',
              value: 3,
            },
          ],
          textFill: 0x000000FF as RgbaU32,
          textStroke: 0xEFEFEFFF as RgbaU32,
          textScale: 0.45,
          z: Z_OVERLAY_TEXT,
        },
      ],
      polygons: [],
    },
    {
      layerName: 'place',
      minZoom: 7,
      maxZoom: 11,
      lines: [],
      points: [
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              'province',
              'state',
            ],
          }],
          textFill: 0x000000FF as RgbaU32,
          textStroke: 0xEFEFEFFF as RgbaU32,
          textScale: 0.6,
          z: Z_OVERLAY_TEXT,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              'city',
            ],
          }],
          textFill: 0x000000FF as RgbaU32,
          textStroke: 0xEFEFEFFF as RgbaU32,
          textScale: 0.4,
          z: Z_OVERLAY_TEXT,
        },
      ],
      polygons: [],
    },
    {
      layerName: 'place',
      minZoom: 11,
      maxZoom: 31,
      lines: [],
      points: [
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              'city',
              'continent',
              'province',
              'state',
              'town',
            ],
          }],
          textFill: 0x000000FF as RgbaU32,
          textStroke: 0xEFEFEFFF as RgbaU32,
          textScale: 0.5,
          z: Z_OVERLAY_TEXT,
        },
      ],
      polygons: [],
    },
    {
      layerName: 'transportation',
      minZoom: 0,
      maxZoom: 11,
      lines: [
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
          radius: 0.75,
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
          radius: 0.75,
          stipple: false,
          z: Z_OVERLAY_TRANSPORTATION,
        },
      ],
      points: [],
      polygons: [],
    },
    {
      layerName: 'transportation',
      minZoom: 11,
      maxZoom: 31,
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
              'transit',
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
      points: [],
      polygons: [],
    },
    {
      layerName: 'water',
      minZoom: 0,
      maxZoom: 31,
      lines: [],
      points: [],
      polygons: [
        {
          filters: [{
            match: 'always',
          }],
          fill: 0x52BAEBFF as RgbaU32,
          z: Z_BASE_WATER + 0.1, // put polygons above lines
        },
      ],
    },
    {
      layerName: 'waterway',
      minZoom: 0,
      maxZoom: 31,
      lines: [
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              'canal',
              'river',
              'stream',
            ],
          }],
          fill: 0x52BAEBFF as RgbaU32,
          stroke: 0x52BAEBFF as RgbaU32,
          radius: 0.5,
          stipple: false,
          z: Z_BASE_WATER,
        },
      ],
      points: [],
      polygons: [],
    },
  ],
};

export class MbtileLayer extends Layer {

  private readonly fetcher: WorkerPool<FetcherRequest, FetcherCommand>;
  private fetching: boolean;
  private readonly loader: QueuedWorkerPool<LoaderRequest, LoaderResponse>;
  private readonly loading: HashMap<TileId, Task<LoaderResponse>>;
  private readonly textBuffer: ArrayBuffer;
  private readonly textGlBuffer: WebGLBuffer;
  private readonly tiles: HashMap<TileId, LoadedTile>;
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
    this.fetcher = new WorkerPool('/static/xyz_data_fetcher_worker.js', 1);
    this.fetching = false;
    this.loader = new QueuedWorkerPool('/static/mbtile_loader_worker.js', 6);
    this.loading = new HashMap(id => `${id.zoom},${id.x},${id.y}`);
    this.textBuffer = new ArrayBuffer(4194304);
    this.textGlBuffer = renderer.createDataBuffer(this.textBuffer.byteLength);
    this.tiles = new HashMap(id => `${id.zoom},${id.x},${id.y}`);
    this.registerDisposer(() => {
      this.renderer.deleteBuffer(this.textGlBuffer);

      for (const response of this.tiles.values()) {
        this.renderer.deleteBuffer(response.glGeometryBuffer);
        this.renderer.deleteBuffer(response.glIndexBuffer);
      }
    });
    this.generation = 0;
    this.lastRenderGeneration = -1;

    this.fetcher.onresponse = command => {
      if (command.kind === 'ltc') {
        this.loadRawTile(command);
      } else if (command.kind === 'utc') {
        this.unloadTiles(command.ids);
      } else if (command.kind === 'usc') {
        this.fetching = command.fetching;
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

    this.fetcher.broadcast({
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

  override hasNewData(): boolean {
    return this.generation !== this.lastRenderGeneration;
  }

  override loadingData(): boolean {
    return this.fetching || this.loading.size > 0;
  }

  override render(planner: Planner): void {
    // Draw highest detail to lowest, we use the stencil buffer to avoid overdraw.
    const sorted = [...this.tiles].sort((a, b) => b[0].zoom - a[0].zoom);
    let textByteSize = 0;
    for (const [id, response] of sorted) {
      planner.add(response.drawables);

      for (const label of response.labels) {
        const {byteSize, drawables} = GLYPHER.plan(
            label.graphemes,
            label.center,
            [0, 0],
            label.scale,
            0,
            label.fill,
            label.stroke,
            label.z,
            this.textBuffer,
            textByteSize,
            this.textGlBuffer,
            this.renderer);
        planner.add(drawables);
        textByteSize += byteSize;
      }
    }
    this.renderer.uploadData(this.textBuffer, textByteSize, this.textGlBuffer);

    this.lastRenderGeneration = this.generation;
  }

  override viewportChanged(bounds: S2LatLngRect, zoom: number): void {
    const lat = bounds.lat();
    const lng = bounds.lng();
    this.fetcher.post({
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

    const id = command.id;
    const task = this.loader.post({
      kind: 'lr',
      id,
      data: command.data,
    }, [command.data]);
    this.loading.set(id, task);
  }

  private loadProcessedTile(response: LoadResponse): void {
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

    this.loading.delete(response.id);
    this.tiles.set(response.id, {
      glGeometryBuffer: geometry,
      glIndexBuffer: index,
      drawables,
      labels: response.labels,
    });
    this.generation += 1;

    this.fetcher.broadcast({
      kind: 'tlr',
      id: response.id,
    });
  }

  private unloadTiles(ids: TileId[]): void {
    for (const id of ids) {
      const task = this.loading.get(id);
      if (task) {
        this.loading.delete(id);
        task.cancel();
      }

      const response = this.tiles.get(id);
      if (response) {
        this.tiles.delete(id);
        this.renderer.deleteBuffer(response.glGeometryBuffer);
        this.renderer.deleteBuffer(response.glIndexBuffer);
      }
    }

    this.generation += 1;
  }
}

