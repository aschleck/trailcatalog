import { S2LatLng, S2LatLngRect } from 'java/org/trailcatalog/s2';
import { checkExhaustive } from 'external/dev_april_corgi+/js/common/asserts';
import { LittleEndianView } from 'external/dev_april_corgi+/js/common/little_endian_view';
import { WorkerPool } from 'external/dev_april_corgi+/js/common/worker_pool';
import { POINTS_ATLAS_SIZE, pointsAtlasIndex } from 'java/org/trailcatalog/client/points/points_atlas';
import { aDescendsB, PointCategory } from 'java/org/trailcatalog/models/categories';
import { Camera, projectS2LatLng } from 'js/map/camera';
import { RawUuid, RgbaU32, Vec2 } from 'js/map/common/types';
import { EventSource, Layer } from 'js/map/layer';
import { BillboardProgram } from 'js/map/rendering/billboard_program';
import { growBuffer } from 'js/map/rendering/buffers';
import { Planner } from 'js/map/rendering/planner';
import { Drawable } from 'js/map/rendering/program';
import { Renderer } from 'js/map/rendering/renderer';
import { TexturePool } from 'js/map/rendering/texture_pool';
import { CellKey, Command as FetcherCommand, LoadCellCommand, Request as FetcherRequest, Snap, Stream, UnloadCellsCommand } from 'js/map/workers/s2_data_fetcher';
import { Z_OVERLAY_TEXT, Z_USER_DATA_HIGHLIGHT } from 'js/map/z';

import { DOUBLE_CLICK_MS, HOVER_CHANGED, OBJECT_OPENED } from './events';
import { Data } from './workers/collection_loader';

// Keep in sync with ApiServer.kt#KIND_PACKED_POINT.
const KIND_PACKED_POINT = 2;

// The sizes trailcatalog draws its points at, see trail_layer.ts
const ICON_SIZE_PX = [20, 20] as Vec2;
const HOVER_ICON_SIZE_PX = [28, 28] as Vec2;
const NO_OFFSET = [0, 0] as Vec2;
// Past about half the icon the cursor is on the map around it.
const HOVER_RADIUS_PX = 10;
// A viewport at zoom 14 holds a few hundred points, and 64 bytes apiece fits that.
const INITIAL_BUFFER_BYTES = 65536;

// The server has nothing to simplify in a point.
const NO_SNAP: Snap[] = [{minZoom: 0, snap: undefined}];

const TEXT_DECODER = new TextDecoder();

/** A point a PointCollectionLayer drew from its collection. */
export interface Point {
  id: RawUuid;
  // The OSM node id and PointCategory, plus the name when the node has one
  data: Data;
  // Mercator
  position: Vec2;
}

/** Draws a collection of points as trailcatalog's icons, and opens one on a double click. */
export class PointCollectionLayer extends Layer {

  private readonly fetcher: WorkerPool<FetcherRequest, FetcherCommand>;
  private fetching: boolean;
  private readonly cells: Map<CellKey, Point[]>;
  private readonly atlas: WebGLTexture;
  private atlasLoaded: boolean;
  private buffer: ArrayBuffer;
  private readonly glBuffer: WebGLBuffer;
  private drawables: Drawable[];
  // Bumped by anything that changes what draws, so render knows to plan again
  private generation: number;
  private lastRenderGeneration: number;
  // Only points descending from these draw and answer the cursor
  private categories: PointCategory[];
  private hovered: Point|undefined;
  private lastClick: {point: Point; timeMs: number}|undefined;

  constructor(
      url: string,
      streams: Stream[],
      categories: PointCategory[],
      private readonly minZoom: number,
      private readonly camera: Camera,
      private readonly renderer: Renderer,
  ) {
    super(/* copyright= */ []);
    this.fetcher = new WorkerPool(new URL('s2_data_fetcher_worker.js', import.meta.url).href, 1);
    this.fetching = false;
    this.cells = new Map();
    const pool = new TexturePool(renderer);
    this.registerDisposable(pool);
    this.atlas = pool.acquire();
    this.atlasLoaded = false;
    this.buffer = new ArrayBuffer(INITIAL_BUFFER_BYTES);
    this.glBuffer = renderer.createDataBuffer(INITIAL_BUFFER_BYTES);
    this.registerDisposer(() => {
      this.renderer.deleteBuffer(this.glBuffer);
    });
    this.drawables = [];
    this.generation = 0;
    this.lastRenderGeneration = -1;
    this.categories = categories;
    this.hovered = undefined;
    this.lastClick = undefined;

    this.fetcher.onresponse = command => {
      if (command.kind === 'lcc') {
        this.loadCell(command);
      } else if (command.kind === 'ucc') {
        this.unloadCells(command);
      } else if (command.kind === 'usc') {
        this.fetching = command.fetching;
      } else if (command.kind === 'spc') {
        // trailcatalog points have no presentation
      } else {
        checkExhaustive(command);
      }
    };
    this.fetcher.broadcast({
      kind: 'ir',
      covering: url + '/covering',
      snaps: NO_SNAP,
      streams,
      url: url + '/objects',
    });

    fetch(new URL('images/atlases/points.png', import.meta.url))
        .then(response => {
          if (!response.ok) {
            throw new Error(`Unable to fetch the points atlas: ${response.status}`);
          }
          return response.blob();
        })
        .then(blob => createImageBitmap(blob))
        .then(bitmap => {
          this.renderer.uploadTexture(bitmap, this.atlas);
          this.atlasLoaded = true;
          this.generation += 1;
        });
  }

  /** Shows only the points descending from the categories. */
  setCategories(categories: PointCategory[]): void {
    this.categories = categories;
    if (this.hovered && !this.shows(this.hovered)) {
      this.hovered = undefined;
    }
    this.generation += 1;
  }

  override click(point: S2LatLng, px: [number, number], contextual: boolean, source: EventSource): boolean {
    const now = performance.now();
    const target = this.pointAt(point);
    const last = this.lastClick;
    this.lastClick = target ? {point: target, timeMs: now} : undefined;
    if (target && last && last.point === target && now - last.timeMs < DOUBLE_CLICK_MS) {
      source.trigger(OBJECT_OPENED, {layer: this, object: {kind: 'point', value: target}});
    }
    // Claimed, or else the way under the icon opens instead.
    return target !== undefined;
  }

  override hover(point: S2LatLng, source: EventSource): boolean {
    const target = this.pointAt(point);
    if (target !== this.hovered) {
      this.hovered = target;
      this.generation += 1;
      source.trigger(HOVER_CHANGED, {target});
    }
    return target !== undefined;
  }

  override hoverLost(source: EventSource): void {
    if (!this.hovered) {
      return;
    }

    this.hovered = undefined;
    this.generation += 1;
    source.trigger(HOVER_CHANGED, {target: undefined});
  }

  override hasNewData(): boolean {
    return this.generation !== this.lastRenderGeneration;
  }

  override loadingData(): boolean {
    return this.fetching;
  }

  override render(planner: Planner, zoom: number): void {
    if (!this.atlasLoaded || zoom < this.minZoom) {
      this.lastRenderGeneration = this.generation;
      return;
    }

    if (this.lastRenderGeneration !== this.generation) {
      this.plan();
    }
    planner.add(this.drawables);
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

  // The hovered point draws again on top and larger, so it needs no hole cut where it was.
  private plan(): void {
    const shown = [];
    for (const points of this.cells.values()) {
      shown.push(...points.filter(point => this.shows(point)));
    }
    const count = shown.length + (this.hovered ? 1 : 0);
    this.buffer = growBuffer(this.buffer, count * BillboardProgram.bytesNeeded());

    const drawables: Drawable[] = [];
    let offset = 0;
    const push = (point: Point, size: Vec2, z: number) => {
      const {byteSize, drawable} =
          this.renderer.billboardProgram.plan(
              point.position,
              NO_OFFSET,
              size,
              /* angle= */ 0,
              /* tint= */ 0xFFFFFFFF as RgbaU32,
              z,
              pointsAtlasIndex(point.data.type as number),
              POINTS_ATLAS_SIZE,
              this.buffer,
              offset,
              this.glBuffer,
              this.atlas);
      drawables.push(drawable);
      offset += byteSize;
    };
    for (const point of shown) {
      push(point, ICON_SIZE_PX, Z_OVERLAY_TEXT + 0.5);
    }
    if (this.hovered) {
      push(this.hovered, HOVER_ICON_SIZE_PX, Z_USER_DATA_HIGHLIGHT);
    }

    this.renderer.uploadData(this.buffer, offset, this.glBuffer);
    this.drawables = drawables;
  }

  // The nearest point within HOVER_RADIUS_PX, since icons overlap where points crowd together
  private pointAt(point: S2LatLng): Point|undefined {
    if (this.camera.zoom < this.minZoom) {
      return undefined;
    }

    const [x, y] = projectS2LatLng(point);
    // A mercator unit is worldRadius pixels.
    const radius = HOVER_RADIUS_PX * this.camera.inverseWorldRadius;
    let best = undefined;
    let bestDistance2 = radius * radius;
    for (const points of this.cells.values()) {
      for (const candidate of points) {
        if (!this.shows(candidate)) {
          continue;
        }
        const dx = candidate.position[0] - x;
        const dy = candidate.position[1] - y;
        const distance2 = dx * dx + dy * dy;
        if (distance2 < bestDistance2) {
          best = candidate;
          bestDistance2 = distance2;
        }
      }
    }
    return best;
  }

  private shows(point: Point): boolean {
    const type = point.data.type as number;
    return this.categories.some(category => aDescendsB(type, category));
  }

  private loadCell(command: LoadCellCommand): void {
    const source = new LittleEndianView(command.data);
    // Version 3 only changed the other kinds, so packed points read the same in 2 and 3.
    const version = source.getVarInt32();
    if (version !== 2 && version !== 3) {
      throw new Error(`Unhandled version ${version}`);
    }
    const kind = source.getVarInt32();
    if (kind !== KIND_PACKED_POINT) {
      throw new Error(`Expected packed points, got kind ${kind}`);
    }

    const points = [];
    const count = source.getVarInt32();
    for (let i = 0; i < count; ++i) {
      // id,type,name,marker
      const id = source.getVarBigInt64();
      const type = source.getVarInt32();
      const name = TEXT_DECODER.decode(source.sliceInt8(source.getVarInt32()));
      const latE7 = source.getInt32();
      const lngE7 = source.getInt32();
      const data: Data = {id: Number(id), type};
      if (name) {
        data.name = name;
      }
      points.push({
        id: {lsb: id, msb: 0n},
        data,
        position: projectS2LatLng(S2LatLng.fromE7(latE7, lngE7)),
      });
    }
    this.cells.set(command.key, points);
    this.generation += 1;
  }

  private unloadCells(command: UnloadCellsCommand): void {
    for (const key of command.keys) {
      const points = this.cells.get(key);
      if (this.hovered && points?.includes(this.hovered)) {
        this.hovered = undefined;
      }
      this.cells.delete(key);
    }
    this.generation += 1;
  }
}
