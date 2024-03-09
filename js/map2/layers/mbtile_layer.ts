import { S2LatLngRect } from 'java/org/trailcatalog/s2';
import * as arrays from 'js/common/arrays';
import { checkExhaustive } from 'js/common/asserts';
import { HashMap, HashSet } from 'js/common/collections';
import { QueuedWorkerPool, Task } from 'js/common/queued_worker_pool';
import { WorkerPool } from 'js/common/worker_pool';

import { WorldBoundsQuadtree } from '../common/bounds_quadtree';
import { Copyright, Rect, RgbaU32, TileId, Vec2 } from '../common/types';
import { Layer } from '../layer';
import { GLYPHER } from '../rendering/glypher';
import { Planner } from '../rendering/planner';
import { Drawable } from '../rendering/program';
import { Renderer } from '../rendering/renderer';
import { Label, LoadResponse, Request as LoaderRequest, Response as LoaderResponse, Style } from '../workers/mbtile_loader';
import { Command as FetcherCommand, LoadTileCommand, Request as FetcherRequest, UnloadTilesCommand } from '../workers/xyz_data_fetcher';
import { Z_BASE_TERRAIN, Z_BASE_WATER, Z_OVERLAY_TERRAIN, Z_OVERLAY_TEXT, Z_OVERLAY_TRANSPORTATION } from '../z';

interface LoadedTile {
  drawables: Drawable[];
  glGeometryBuffer: WebGLBuffer;
  glIndexBuffer: WebGLBuffer;
  labels: IndexedLabel[];
}

interface IndexedLabel extends Label {
  bound: Rect;
  collidedMinZoom: number;
  radius: Vec2;
}

export const CONTOURS_FEET: Readonly<Style> = {
  layers: [
    {
      layerName: 'contour_ft',
      minZoom: 0,
      maxZoom: 14,
      lines: [
        {
          filters: [{
            match: 'greater_than',
            key: 'nth_line',
            value: 2,
          }],
          fill: 0x00000040 as RgbaU32,
          stroke: 0x00000040 as RgbaU32,
          radius: 0.5,
          stipple: false,
          z: Z_OVERLAY_TERRAIN,
        },
      ],
      points: [],
      polygons: [],
    },
    {
      layerName: 'contour_ft',
      minZoom: 14,
      maxZoom: 31,
      lines: [
        {
          filters: [],
          fill: 0x00000040 as RgbaU32,
          stroke: 0x00000040 as RgbaU32,
          radius: 0.5,
          stipple: false,
          z: Z_OVERLAY_TERRAIN,
        },
      ],
      points: [],
      polygons: [],
    },
  ],
};

export const CONTOURS_METERS: Readonly<Style> = {
  layers: [
    {
      layerName: 'contour',
      minZoom: 0,
      maxZoom: 13,
      lines: [
        {
          filters: [{
            match: 'greater_than',
            key: 'nth_line',
            value: 2,
          }],
          fill: 0x00000040 as RgbaU32,
          stroke: 0x00000040 as RgbaU32,
          radius: 0.5,
          stipple: false,
          z: Z_OVERLAY_TERRAIN,
        },
      ],
      points: [],
      polygons: [],
    },
    {
      layerName: 'contour',
      minZoom: 13,
      maxZoom: 31,
      lines: [
        {
          filters: [],
          fill: 0x00000040 as RgbaU32,
          stroke: 0x00000040 as RgbaU32,
          radius: 0.5,
          stipple: false,
          z: Z_OVERLAY_TERRAIN,
        },
      ],
      points: [],
      polygons: [],
    },
  ],
};

export const NATURE: Readonly<Style> = {
  layers: [
    {
      layerName: 'aeroway',
      minZoom: 11,
      maxZoom: 12,
      lines: [
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              'runway',
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
      layerName: 'aeroway',
      minZoom: 12,
      maxZoom: 13,
      lines: [
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              'runway',
            ],
          }],
          fill: 0xFFFFFFFF as RgbaU32,
          stroke: 0xFFFFFFFF as RgbaU32,
          radius: 3,
          stipple: false,
          z: Z_OVERLAY_TRANSPORTATION,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              'taxiway',
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
      layerName: 'aeroway',
      minZoom: 13,
      maxZoom: 14,
      lines: [
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              'runway',
            ],
          }],
          fill: 0xFFFFFFFF as RgbaU32,
          stroke: 0xFFFFFFFF as RgbaU32,
          radius: 4,
          stipple: false,
          z: Z_OVERLAY_TRANSPORTATION,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              'taxiway',
            ],
          }],
          fill: 0xFFFFFFFF as RgbaU32,
          stroke: 0xFFFFFFFF as RgbaU32,
          radius: 2,
          stipple: false,
          z: Z_OVERLAY_TRANSPORTATION,
        },
      ],
      points: [],
      polygons: [],
    },
    {
      layerName: 'aeroway',
      minZoom: 14,
      maxZoom: 15,
      lines: [
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              'runway',
            ],
          }],
          fill: 0xFFFFFFFF as RgbaU32,
          stroke: 0xFFFFFFFF as RgbaU32,
          radius: 6,
          stipple: false,
          z: Z_OVERLAY_TRANSPORTATION,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              'taxiway',
            ],
          }],
          fill: 0xFFFFFFFF as RgbaU32,
          stroke: 0xFFFFFFFF as RgbaU32,
          radius: 3,
          stipple: false,
          z: Z_OVERLAY_TRANSPORTATION,
        },
      ],
      points: [],
      polygons: [],
    },
    {
      layerName: 'aeroway',
      minZoom: 15,
      maxZoom: 31,
      lines: [
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              'runway',
            ],
          }],
          fill: 0xFFFFFFFF as RgbaU32,
          stroke: 0xFFFFFFFF as RgbaU32,
          radius: 8,
          stipple: false,
          z: Z_OVERLAY_TRANSPORTATION,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              'taxiway',
            ],
          }],
          fill: 0xFFFFFFFF as RgbaU32,
          stroke: 0xFFFFFFFF as RgbaU32,
          radius: 4,
          stipple: false,
          z: Z_OVERLAY_TRANSPORTATION,
        },
      ],
      points: [],
      polygons: [],
    },
    {
      layerName: 'contour_ft',
      minZoom: 0,
      maxZoom: 31,
      lines: [
        {
          filters: [{
            match: 'greater_than',
            key: 'nth_line',
            value: 2,
          }],
          fill: 0x00000040 as RgbaU32,
          stroke: 0x00000040 as RgbaU32,
          radius: 0.5,
          stipple: false,
          z: Z_OVERLAY_TERRAIN,
        },
      ],
      points: [],
      polygons: [],
    },
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
          z: Z_BASE_TERRAIN + 0.8,
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
          fill: 0x51C5874C as RgbaU32,
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
      maxZoom: 11,
      lines: [],
      points: [
        {
          filters: [
            {
              match: 'string_in',
              key: 'class',
              value: [
                'national_park',
                'wilderness_area',
              ],
            },
          ],
          textFill: 0x007D25FF as RgbaU32,
          textStroke: 0xEFEFEFFF as RgbaU32,
          textScale: 0.4,
          z: Z_OVERLAY_TEXT,
        },
      ],
      polygons: [
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              //'city_park',
              //'county_park',
              // TODO(april): this looks gross at the nortern tip of Greenland
              'national_park',
              'wilderness_area',
              //'nature_reserve',
              //'open_space_preserve',
              //'regional_park',
              //'state_park',
              //'state_wilderness',
            ],
          }],
          fill: 0x21ad5780 as RgbaU32,
          z: Z_BASE_TERRAIN + 0.75,
        },
      ],
    },
    {
      layerName: 'park',
      minZoom: 11,
      maxZoom: 31,
      lines: [],
      points: [
        {
          filters: [
            {
              match: 'string_in',
              key: 'class',
              value: [
                'national_park',
                'wilderness_area',
              ],
            },
          ],
          textFill: 0x007D25FF as RgbaU32,
          textStroke: 0xEFEFEFFF as RgbaU32,
          textScale: 0.4,
          z: Z_OVERLAY_TEXT,
        },
      ],
      polygons: [
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              //'city_park',
              //'county_park',
              // TODO(april): this looks gross at the nortern tip of Greenland
              'national_park',
              'wilderness_area',
              //'nature_reserve',
              //'open_space_preserve',
              //'regional_park',
              //'state_park',
              //'state_wilderness',
            ],
          }],
          fill: 0x13653220 as RgbaU32,
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
          z: Z_OVERLAY_TEXT + 0.1,
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
          z: Z_OVERLAY_TEXT + 0.2,
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
          z: Z_OVERLAY_TEXT + 0.1,
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
              'city',
            ],
          }],
          textFill: 0x000000FF as RgbaU32,
          textStroke: 0xEFEFEFFF as RgbaU32,
          textScale: 0.4,
          z: Z_OVERLAY_TEXT,
        },
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
          z: Z_OVERLAY_TEXT + 0.01,
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
          textScale: 0.4,
          z: Z_OVERLAY_TEXT + 0.01,
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
  private readonly labelIndex: WorldBoundsQuadtree<IndexedLabel>;
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
    this.labelIndex = new WorldBoundsQuadtree();
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

  override render(planner: Planner, zoom: number): void {
    const zoomFloor = Math.floor(zoom);

    // TODO(april): this results in bad behavior like low zoom tiles drawing over what should be
    // background at high zoom. We need to drop the depth buffer and just be careful about overdraw
    // with xyz tiles. Sad.
    //
    // Orrrr we could add a tile wide quad at the start of every tile...? But then we need the
    // stencil buffer not depth.
    const sorted = [...this.tiles].sort((a, b) => b[0].zoom - a[0].zoom);
    let textByteSize = 0;
    for (const [id, response] of sorted) {
      planner.add(response.drawables);

      for (const label of response.labels) {
        if (label.collidedMinZoom > zoom) {
          continue;
        }

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
    const geometry = this.renderer.createDataBuffer(response.geometry.byteLength);
    const index = this.renderer.createIndexBuffer(response.index.byteLength);
    this.renderer.uploadData(response.geometry, response.geometry.byteLength, geometry);
    this.renderer.uploadIndices(response.index, response.index.byteLength, index);
    const drawables = [];

    const labels = [];
    const padding = 2;
    for (const label of response.labels) {
      const [wr, hr] = GLYPHER.measurePx(label.graphemes, label.scale);
      const w = wr + 2 * padding;
      const h = hr + 2 * padding;
      const mzWorldSize = 256 * Math.pow(2, label.minZoom);
      const hwWorld = w / mzWorldSize; // no divide by 2 because the world is -1 to 1
      const hhWorld = h / mzWorldSize;
      const maximalBound = {
        low: [label.center[0] - hwWorld, label.center[1] - hhWorld],
        high: [label.center[0] + hwWorld, label.center[1] + hhWorld],
      } as const;

      const indexed = {
        ...label,
        bound: maximalBound,
        collidedMinZoom: label.minZoom,
        radius: [w, h] as const, // no divide by 2 because the world is -1 to 1
      };
      this.recalculateCollisionZoom(indexed);

      labels.push(indexed);
      this.labelIndex.insert(indexed, maximalBound);
    }

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
      labels,
    });
    this.generation += 1;

    this.fetcher.broadcast({
      kind: 'tlr',
      id: response.id,
    });
  }

  private unloadTiles(ids: TileId[]): void {
    const affectedLabels = new Set<IndexedLabel>();
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
        
        for (const label of response.labels) {
          affectedLabels.delete(label);
          this.labelIndex.delete(label.bound);

          const affected: IndexedLabel[] = [];
          this.labelIndex.queryRect(label.bound, affected);
          for (const other of affected) {
            if (label.collidedMinZoom >= other.collidedMinZoom) {
              // We didn't affect other, so skip recalculating it
              continue;
            }

            affectedLabels.add(other);
          }
        }
      }
    }

    // We recalculate after all tiles are unloaded because we may be unloading every label.
    for (const label of affectedLabels) {
      this.recalculateCollisionZoom(label);
    }

    this.generation += 1;
  }

  private recalculateCollisionZoom(label: IndexedLabel): void {
    const neighbors: IndexedLabel[] = [];
    this.labelIndex.queryRect(label.bound, neighbors);

    let ourMinZoom = label.minZoom;
    const [wr, hr] = label.radius;
    for (const other of neighbors) {
      if (label.maxZoom <= other.collidedMinZoom || label.minZoom >= other.maxZoom) {
        continue;
      }
      if (arrays.equals(label.graphemes, other.graphemes)) {
        continue;
      }

      const collisionZoom = Math.max(ourMinZoom, other.collidedMinZoom);
      const worldSize = 256 * Math.pow(2, collisionZoom);
      const ourRadius = [wr / worldSize, hr / worldSize];
      const theirRadius = [other.radius[0] / worldSize, other.radius[1] / worldSize];
      const overlapX =
          Math.abs(label.center[0] - other.center[0]) - ourRadius[0] - theirRadius[0];
      const overlapY =
          Math.abs(label.center[1] - other.center[1]) - ourRadius[1] - theirRadius[1];
      if (overlapX >= 0 || overlapY >= 0) {
        continue;
      }

      const minimalZoomX =
          Math.log2((wr + other.radius[0]) / Math.abs(label.center[0] - other.center[0]) / 512);
      const minimalZoomY =
          Math.log2((hr + other.radius[1]) / Math.abs(label.center[1] - other.center[1]) / 512);
      const minimalZoom = Math.max(minimalZoomX, minimalZoomY);

      if (label.z === other.z && arrays.compare(label.graphemes, other.graphemes) < 0) {
        other.collidedMinZoom = Math.max(minimalZoom, other.collidedMinZoom);
      } else if (label.z > other.z) {
        other.collidedMinZoom = Math.max(minimalZoom, other.collidedMinZoom);
      } else {
        ourMinZoom = Math.max(ourMinZoom, minimalZoom);
      }
    }

    label.collidedMinZoom = ourMinZoom;
  }
}

