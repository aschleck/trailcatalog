import * as geotiff from 'geotiff';
import { GeoTIFF, GeoTIFFImage } from 'geotiff';

import { S2LatLng, S2LatLngRect, S2Point, S2Polygon } from 'java/org/trailcatalog/s2';
import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';
import { checkExhaustive, checkExists } from 'external/dev_april_corgi+/js/common/asserts';
import { HashMap, HashSet } from 'external/dev_april_corgi+/js/common/collections';
import { Debouncer } from 'external/dev_april_corgi+/js/common/debouncer';
import { clamp } from 'external/dev_april_corgi+/js/common/math';

import { projectLatLngRect, unprojectS2LatLng } from '../camera';
import { TileId } from '../common/types';

interface InitializeRequest {
  kind: 'ir';
  collection: string;
  daysToFetch: number;
  query: object;
}

interface Viewport {
  lat: [number, number];
  lng: [number, number];
  zoom: number;
}

interface UpdateViewportRequest {
  kind: 'uvr';
  viewport: Viewport;
}

export type Request = InitializeRequest|UpdateViewportRequest;

export interface LoadTileCommand {
  kind: 'ltc';
  id: TileId;
  bitmap: ImageBitmap;
}

export interface UnloadTilesCommand {
  kind: 'utc';
  ids: TileId[];
}

export interface UpdateStateCommand {
  kind: 'usc';
  fetching: boolean;
}

export type Command = LoadTileCommand|UnloadTilesCommand|UpdateStateCommand;

interface EarthSearchFeatureCollection {
  type: 'FeatureCollection';
  context: {
    limit: number;
    matched: number;
    returned: number;
  };
  features: Array<{
    bbox: [lowLng: number, lowLat: number, highLng: number, highLat: number];
    id: string;
    assets: {
      visual: {
        href: string;
        'proj:shape': string;
        'proj:transform': string;
        type: string;
      };
    };
    geometry: {
      type: string;
      coordinates: Array<Array<[lng: number, lat: number]>>;
    };
    properties: {
      'proj:epsg': number;
    };
  }>;
  links: Array<{
    href: string;
    rel: string;
  }>;
}

interface Feature {
  id: string;
  bound: S2LatLngRect;
  epsg: number;
  polygon: S2Polygon;
  visualUrl: string;
  loading: Promise<unknown>|undefined;
  visual: GeoTIFF|undefined;
  // Set once the COG has run out of attempts. Tiles that need this source stop waiting on it, or
  // else the layer sits reporting that it's still fetching and nothing ever wakes it up again.
  failed: boolean;
  // Image 0 plus its overviews, largest first. Finding these walks every image directory in the
  // COG, so we keep the answer per feature instead of redoing it per tile.
  images: Promise<GeoTIFFImage[]>|undefined;
}

// A source raster window, with the affine map from UTM easting/northing into its pixels.
interface Raster {
  xScale: number;
  xBias: number;
  yScale: number;
  yBias: number;
  pixels: Uint8Array;
  width: number;
  height: number;
}

interface WantedTile {
  id: TileId;
  x: number;
  y: number;
  distance: number;
}

interface TileSources {
  sources: Feature[];
  // Whether the sources between them cover the tile. Search results arrive a page at a time and a
  // loaded tile never gets revisited, so a tile drawn short of full coverage has to be given up
  // when a later page lands or it keeps whatever holes the first page left.
  covered: boolean;
}

const MIN_ZOOM = 7;
const MAX_ZOOM = 15;
const RESULTS_LIMIT = 1024;
const RESULTS_PER_PAGE = 200;
// Margin around the viewport to query, as a fraction of its own size on each side, so a small pan
// doesn't need another query. A full viewport per side triples both spans, and at zoom 7 that area
// matches more granules than RESULTS_LIMIT keeps. The results are sorted newest first, so going
// over the limit drops the older granules that are the only cover for part of the screen.
// => 11.7 x 5.9 degrees of viewport at zoom 8.8 matches 274 granules over 7 days
// => at 3x span that is 35.0 x 17.7 degrees and 1438 granules, past the limit
// => at 1.5x span it is 17.5 x 8.9 degrees and 528, which fits
const QUERY_MARGIN_FRACTION = 0.25;
const TILE_SIZE = 512;
// Tiles are reprojected a row at a time on this thread, so more in flight only delays the first
// one. Three is enough to keep the range requests for their windows overlapping.
const CONCURRENT_TILES = 3;
// The union in sourcesFor is built by S2 boolean ops, which snap vertices, so it never comes out
// exactly equal to the tile's own area.
const COVERED_FRACTION = 0.999;
// A source earns its range request by filling at least one row of the output tile, and a row is
// TILE_SIZE of the tile's TILE_SIZE * TILE_SIZE pixels. This is what rejects the granules that
// only graze a tile edge.
const MIN_CONTRIBUTION = 1 / TILE_SIZE;
// Slack on the source window so bilinear taps at the tile edge still have neighbors.
const WINDOW_SLACK_METERS = 100;
// S3 drops geotiff's range requests often enough to leave visible blank tiles, and the same request
// succeeds on a retry. The delay grows per attempt because reading every tile on screen at once is
// part of why they get dropped.
const NETWORK_ATTEMPTS = 3;
const RETRY_DELAY_MS = 250;

// WGS84 and the UTM projection parameters. See llToUtm.
const EARTH_RADIUS = 6378137;
const ECC_SQUARED = 0.00669438;
const ECC_PRIME_SQUARED = ECC_SQUARED / (1 - ECC_SQUARED);
const UTM_SCALE = 0.9996;
const UTM_FALSE_EASTING = 500000;
const UTM_FALSE_NORTHING = 10000000; // southern hemisphere only
// Meridional arc series coefficients, so the eccentricity powers aren't recomputed per row.
const M0 =
    1
        - ECC_SQUARED / 4
        - 3 * ECC_SQUARED * ECC_SQUARED / 64
        - 5 * ECC_SQUARED * ECC_SQUARED * ECC_SQUARED / 256;
const M2 =
    3 * ECC_SQUARED / 8
        + 3 * ECC_SQUARED * ECC_SQUARED / 32
        + 45 * ECC_SQUARED * ECC_SQUARED * ECC_SQUARED / 1024;
const M4 =
    15 * ECC_SQUARED * ECC_SQUARED / 256
        + 45 * ECC_SQUARED * ECC_SQUARED * ECC_SQUARED / 1024;
const M6 = 35 * ECC_SQUARED * ECC_SQUARED * ECC_SQUARED / 3072;

class EarthSearchLoader {

  // Every feature the current query returned, newest first, because sourcesFor prefers the newest
  // imagery that covers a tile.
  private readonly active: Feature[];
  // Keyed by STAC id so a requery reuses the features it already opened COGs for.
  private readonly features: Map<string, Feature>;
  private readonly geotiffPool: geotiff.Pool;
  private readonly loaded: HashSet<TileId>;
  private readonly refreshDebouncer: Debouncer;
  // Tiles drawn from sources that didn't cover them, so a later page of results can put them back
  // in the queue.
  private readonly provisional: HashSet<TileId>;
  // Resolved sources for tiles we couldn't draw yet, so waiting on a COG to open doesn't mean
  // redoing the polygon work for every tile on screen.
  private readonly tileSources: HashMap<TileId, TileSources>;
  private epoch: number;
  private fetching: boolean;
  private generation: number;
  private lastQuery: S2LatLngRect;
  private lastRequest: UpdateViewportRequest;
  private refreshQueued: boolean;
  private refreshing: Promise<void>|undefined;

  constructor(
      private readonly collection: string,
      private readonly daysToFetch: number,
      private readonly query: object,
      private readonly postMessage: (command: Command, transfer?: Transferable[]) => void,
  ) {
    this.active = [];
    this.features = new Map();
    this.geotiffPool = new geotiff.Pool();
    this.loaded = createTileHashSet();
    this.provisional = createTileHashSet();
    this.refreshDebouncer = new Debouncer(/* delayMs= */ 100, () => {
      this.startRefresh();
    });
    this.tileSources = new HashMap(id => `${id.x},${id.y},${id.zoom}`);
    this.epoch = 0;
    this.fetching = false;
    this.generation = 0;
    this.lastQuery = S2LatLngRect.empty();
    this.lastRequest = {
      kind: 'uvr',
      viewport: {
        lat: [1, -1],
        lng: [1, -1],
        zoom: 31,
      },
    };
    this.refreshQueued = false;
    this.refreshing = undefined;
  }

  updateViewport(request: UpdateViewportRequest): void {
    if (request.viewport.zoom < MIN_ZOOM) {
      return;
    }

    // MapController#updateArgs enters idle on every render, so a viewport we already have is worth
    // dropping outright: answering it flips this layer into a loading state, which changes
    // MapController's state, which renders, which enters idle again.
    if (sameViewport(request.viewport, this.lastRequest.viewport)) {
      return;
    }

    this.lastRequest = request;
    // Panning posts a viewport every frame and tiling one costs far more than the debounce, so
    // coalesce them. Bumping the generation also lets a refresh already in flight give up at its
    // next tile instead of finishing tiles that have scrolled off.
    this.generation += 1;
    this.refreshDebouncer.trigger();
  }

  // Only posts on a transition, because MapController turns this into component state and rerenders
  // on every change.
  private setFetching(fetching: boolean): void {
    if (this.fetching === fetching) {
      return;
    }

    this.fetching = fetching;
    this.postMessage({
      kind: 'usc',
      fetching,
    });
  }

  // Runs at most one refresh at a time. The one in flight bails on a generation bump, so queueing
  // behind it costs a tile at worst.
  private startRefresh(): void {
    if (this.refreshing) {
      this.refreshQueued = true;
      return;
    }

    this.refreshing =
        this.refresh()
            .catch(e => {
              console.error(e);
            })
            .then(() => {
              this.refreshing = undefined;
              if (this.refreshQueued) {
                this.refreshQueued = false;
                this.startRefresh();
              }
            });
  }

  private async refresh(): Promise<void> {
    const request = this.lastRequest;
    const generation = this.generation;
    const viewport =
        S2LatLngRect.fromPointPair(
            S2LatLng.fromRadians(request.viewport.lat[0], request.viewport.lng[0]),
            S2LatLng.fromRadians(request.viewport.lat[1], request.viewport.lng[1]));

    if (!this.lastQuery.contains(viewport)) {
      this.setFetching(true);
      await this.queryForFeatures(viewport);
      if (generation !== this.generation) {
        return;
      }
    }

    const zoom = clamp(Math.floor(request.viewport.zoom), 0, MAX_ZOOM);
    await this.tileViewport(viewport, zoom, generation);
  }

  private async tileViewport(
      viewport: S2LatLngRect, zoom: number, generation: number): Promise<void> {
    const halfWorldSize = Math.pow(2, zoom - 1);

    let projected = projectLatLngRect(viewport);
    if (projected.low[0] > projected.high[0]) {
      projected = {
        low: [projected.high[0], projected.low[1]],
        high: [projected.low[0], projected.high[1]],
      };
    }

    // Tile x spans [x, x + 1] while tile y spans [y - 1, y], which is why the two axes round
    // differently.
    const centerX = halfWorldSize * (projected.low[0] + projected.high[0]) / 2;
    const centerY = halfWorldSize * (projected.low[1] + projected.high[1]) / 2;
    const used = createTileHashSet();
    const wanted: WantedTile[] = [];
    for (let y = Math.ceil(halfWorldSize * projected.low[1]);
         y < halfWorldSize * projected.high[1] + 1;
         ++y) {
      for (let x = Math.floor(halfWorldSize * projected.low[0]);
          x < halfWorldSize * projected.high[0];
          ++x) {
        const id = {x: x + halfWorldSize, y: halfWorldSize - y, zoom};
        used.add(id);
        if (this.loaded.has(id)) {
          continue;
        }

        const dX = x + 0.5 - centerX;
        const dY = y - 0.5 - centerY;
        wanted.push({id, x, y, distance: dX * dX + dY * dY});
      }
    }
    // Nearest first, so the tiles the user is looking at land before the ones at the edge of the
    // screen.
    wanted.sort((a, b) => a.distance - b.distance);

    if (wanted.length > 0) {
      this.setFetching(true);
    }

    let allPresent = true;
    let anyOpening = false;
    let next = 0;
    const drawers = [];
    for (let i = 0; i < CONCURRENT_TILES; ++i) {
      drawers.push((async () => {
        while (next < wanted.length && generation === this.generation) {
          const drawn = await this.drawAndPost(wanted[next++], halfWorldSize);
          if (drawn === 'opening') {
            anyOpening = true;
          }
          if (drawn !== 'drawn') {
            allPresent = false;
          }
        }
      })());
    }
    await Promise.all(drawers);

    if (generation !== this.generation) {
      return;
    }

    // Opening a source triggers its own refresh, so stay quiet and let that one report. Anything
    // else is as done as it's going to get, even if some tiles never drew.
    if (anyOpening) {
      return;
    }

    this.setFetching(false);

    if (!allPresent) {
      return;
    }

    const unload = [];
    for (const id of this.loaded) {
      if (used.has(id)) {
        continue;
      }

      this.loaded.delete(id);
      unload.push(id);
    }

    if (unload.length > 0) {
      this.postMessage({
        kind: 'utc',
        ids: unload,
      });
    }
  }

  // 'opening' means a source is still being opened and will trigger another refresh when it
  // lands. 'stuck' means one refused to open, so this tile is never going to draw.
  private async drawAndPost(tile: WantedTile, halfWorldSize: number):
      Promise<'drawn'|'opening'|'stuck'> {
    const tileLow = unprojectS2LatLng(tile.x / halfWorldSize, (tile.y - 1) / halfWorldSize);
    const tileHigh = unprojectS2LatLng((tile.x + 1) / halfWorldSize, tile.y / halfWorldSize);
    const {sources, covered} = this.sourcesFor(tile.id, tileLow, tileHigh);

    // We may just not have the data yet. There's probably an edge case where we have one asset
    // for a point but none of the assets just barely in view.
    if (sources.length < 1) {
      return 'drawn';
    }

    let opening = false;
    let stuck = false;
    for (const source of sources) {
      if (source.visual) {
        continue;
      }

      if (source.failed) {
        stuck = true;
        continue;
      }

      if (!source.loading) {
        // One promise covers every attempt, so a tile waiting on this source sees a single open in
        // flight instead of starting its own.
        source.loading = this.openSource(source);
      }
      opening = true;
    }

    if (opening) {
      return 'opening';
    }
    if (stuck) {
      return 'stuck';
    }

    this.loaded.add(tile.id);
    this.tileSources.delete(tile.id);
    if (covered) {
      this.provisional.delete(tile.id);
    } else {
      this.provisional.add(tile.id);
    }

    try {
      const bitmap =
          await drawTile(
              tile.x, tile.y, halfWorldSize, sources, tileLow, tileHigh, this.geotiffPool);
      this.postMessage({
        kind: 'ltc',
        id: tile.id,
        bitmap,
      }, [bitmap]);
      return 'drawn';
    } catch (e: unknown) {
      // Reading the windows can still fail after retrying. Unmark the tile so the next viewport
      // change picks it up again.
      this.loaded.delete(tile.id);
      console.error(e);
      return 'stuck';
    }
  }

  private async openSource(source: Feature): Promise<void> {
    try {
      source.visual = await retrying(() => geotiff.fromUrl(source.visualUrl));
    } catch (e: unknown) {
      source.failed = true;
      console.error(e);
    }

    this.refreshDebouncer.trigger();
  }

  // Picks the newest features that between them cover the tile.
  private sourcesFor(id: TileId, tileLow: S2LatLng, tileHigh: S2LatLng): TileSources {
    const cached = this.tileSources.get(id);
    if (cached) {
      return cached;
    }

    const bound = S2LatLngRect.fromPointPair(tileLow, tileHigh);
    const asList = SimpleS2.newArrayList<S2Point>();
    asList.add(tileLow.toPoint());
    asList.add(S2LatLng.fromRadians(tileLow.latRadians(), tileHigh.lngRadians()).toPoint());
    asList.add(tileHigh.toPoint());
    asList.add(S2LatLng.fromRadians(tileHigh.latRadians(), tileLow.lngRadians()).toPoint());
    const polygon = SimpleS2.pointsToPolygon(asList);
    const tileArea = polygon.getArea();

    const sources = [];
    let have = SimpleS2.newPolygon();
    let haveArea = 0;
    for (const feature of this.active) {
      if (!feature.bound.intersects(bound)) {
        continue;
      }

      if (!feature.polygon.intersects(polygon)) {
        continue;
      }

      const overlap = SimpleS2.newPolygon();
      const grown = SimpleS2.newPolygon();
      overlap.initToIntersection(polygon, feature.polygon);
      grown.initToUnion(have, overlap);
      const grownArea = grown.getArea();
      // Weigh what a source adds against the tile, not against what we already have. A Sentinel
      // granule is about 110km across, so below zoom 9 a tile needs several of them and each one
      // is the only thing covering its own corner. Measured against a running total, the third
      // granule onward always looks like a rounding error and gets dropped, which leaves the rest
      // of the tile transparent.
      if (grownArea - haveArea <= MIN_CONTRIBUTION * tileArea) {
        continue;
      }

      sources.push(feature);
      have = grown;
      haveArea = grownArea;
      if (haveArea > COVERED_FRACTION * tileArea) {
        break;
      }
    }

    const resolved = {sources, covered: haveArea > COVERED_FRACTION * tileArea};
    this.tileSources.set(id, resolved);
    return resolved;
  }

  private async queryForFeatures(viewport: S2LatLngRect): Promise<void> {
    const size = viewport.getSize();
    const expanded =
        viewport.expanded(
            S2LatLng.fromRadians(
                size.latRadians() * QUERY_MARGIN_FRACTION,
                size.lngRadians() * QUERY_MARGIN_FRACTION));
    const low = expanded.lo();
    const high = expanded.hi();
    const now = new Date();
    const was = new Date();
    was.setDate(now.getDate() - this.daysToFetch);

    const response =
        await fetchFeatures(
            'https://earth-search.aws.element84.com/v1/search?' + new URLSearchParams({
              datetime: `${was.toISOString()}/${now.toISOString()}`,
              limit: String(RESULTS_PER_PAGE),
              collections: this.collection,
              bbox:
                  `${low.lngDegrees()},${low.latDegrees()}`
                      + `,${high.lngDegrees()},${high.latDegrees()}`,
              query: JSON.stringify(this.query),
              sortby: '-properties.datetime',
            }));

    this.epoch += 1;
    this.mergeFeatures(response, /* replace= */ true);
    // Only claim coverage once the query actually landed, or else a failed fetch suppresses the
    // retry.
    this.lastQuery = expanded;
    this.pageRemainingFeatures(response, RESULTS_LIMIT - response.features.length, this.epoch);
  }

  // Results come back newest first, so the first page already covers most of the viewport. We page
  // the rest in the background and redraw as it arrives rather than making the first tile wait on
  // five round trips.
  private pageRemainingFeatures(
      response: EarthSearchFeatureCollection, limit: number, epoch: number): void {
    if (limit <= 0 || epoch !== this.epoch) {
      return;
    }

    const next = response.links.find(link => link.rel === 'next');
    if (!next) {
      return;
    }

    fetchFeatures(next.href).then(page => {
      if (epoch !== this.epoch || page.features.length < 1) {
        // The search advertises a next link even when it already returned everything it matched,
        // so an empty page means stop rather than page forever without making progress.
        return;
      }

      this.mergeFeatures(page, /* replace= */ false);
      this.refreshDebouncer.trigger();
      this.pageRemainingFeatures(page, limit - page.features.length, epoch);
    }, e => {
      console.error(e);
    });
  }

  private mergeFeatures(response: EarthSearchFeatureCollection, replace: boolean): void {
    if (replace) {
      this.active.length = 0;
    }

    for (const feature of response.features) {
      const existing = this.features.get(feature.id);
      if (existing) {
        this.active.push(existing);
        continue;
      }

      if (feature.geometry.type !== 'Polygon') {
        console.error(`Unexpected ${feature.geometry.type} shape for asset`);
        continue;
      }
      if (feature.geometry.coordinates.length !== 1) {
        console.error(
            `Unexpected ${feature.geometry.coordinates.length} shape for coordinates`);
        continue;
      }

      const bound =
          S2LatLngRect.fromPointPair(
              S2LatLng.fromDegrees(feature.bbox[1], feature.bbox[0]),
              S2LatLng.fromDegrees(feature.bbox[3], feature.bbox[2]));
      const asList = SimpleS2.newArrayList<S2Point>();
      const coords = feature.geometry.coordinates[0];
      // The last vertex is the first
      for (let i = 0; i < coords.length - 1; ++i) {
        const c = coords[i];
        asList.add(S2LatLng.fromDegrees(c[1], c[0]).toPoint());
      }

      const parsed = {
        id: feature.id,
        bound,
        epsg: feature.properties['proj:epsg'],
        polygon: SimpleS2.pointsToPolygon(asList),
        visualUrl: feature.assets.visual.href,
        loading: undefined,
        visual: undefined,
        failed: false,
        images: undefined,
      };
      this.features.set(parsed.id, parsed);
      this.active.push(parsed);
    }

    if (replace) {
      const keep = new Set(this.active.map(f => f.id));
      for (const id of this.features.keys()) {
        if (!keep.has(id)) {
          this.features.delete(id);
        }
      }
    }

    // A newer feature can be a better source for a tile we already resolved.
    this.tileSources.clear();

    // Give up the tiles this page might fill in. Without this they keep the holes the earlier
    // pages left, because tileViewport skips anything already loaded.
    for (const id of this.provisional) {
      this.loaded.delete(id);
    }
    this.provisional.clear();
  }
}

function start(ir: InitializeRequest) {
  const fetcher =
      new EarthSearchLoader(
          ir.collection,
          ir.daysToFetch,
          ir.query,
          (self as any).postMessage.bind(self));
  self.onmessage = e => {
    const request = e.data as Request;
    if (request.kind === 'ir') {
      throw new Error('Already initialized');
    } else if (request.kind === 'uvr') {
      fetcher.updateViewport(request);
    } else {
      checkExhaustive(request);
    }
  };
}

function fetchFeatures(url: string): Promise<EarthSearchFeatureCollection> {
  return fetch(url).then(response => response.json() as Promise<EarthSearchFeatureCollection>);
}

// Reissues a dropped geotiff request. See NETWORK_ATTEMPTS.
async function retrying<V>(request: () => Promise<V>): Promise<V> {
  for (let attempt = 1; ; ++attempt) {
    try {
      return await request();
    } catch (e: unknown) {
      if (attempt >= NETWORK_ATTEMPTS) {
        throw e;
      }

      await new Promise(resolve => {
        setTimeout(resolve, attempt * RETRY_DELAY_MS);
      });
    }
  }
}

function sameViewport(a: Viewport, b: Viewport): boolean {
  return a.zoom === b.zoom
      && a.lat[0] === b.lat[0] && a.lat[1] === b.lat[1]
      && a.lng[0] === b.lng[0] && a.lng[1] === b.lng[1];
}

function createTileHashSet(): HashSet<TileId> {
  return new HashSet(id => `${id.x},${id.y},${id.zoom}`);
}

function epsgToUtmZone(epsg: number): number {
  // It seems weird that we don't care about north vs south. YouTim (below) seems sketchy.
  if (epsg < 32601) {
    throw new Error("Not a UTM zone");
  } else if (epsg < 32661) {
    return epsg - 32600;
  } else if (epsg < 32701) {
    throw new Error("Not a UTM zone");
  } else if (epsg < 32761) {
    return epsg - 32700;
  } else {
    throw new Error("Not a UTM zone");
  }
}

async function drawTile(
        tileX: number,
        tileY: number,
        halfWorldSize: number,
        sources: Feature[],
        tileLow: S2LatLng,
        tileHigh: S2LatLng,
        pool: geotiff.Pool):
    Promise<ImageBitmap> {
  // Fetching every window up front overlaps the range requests, but we paint front to back and
  // skip pixels an earlier source already filled, so a source that's only there to fill holes
  // costs about what its holes are worth.
  const rasters = await Promise.all(sources.map(s => getRaster(s, tileLow, tileHigh, pool)));
  const data = new ArrayBuffer(TILE_SIZE * TILE_SIZE * 4);
  const pixels = new Uint32Array(data);
  for (let i = 0; i < rasters.length; ++i) {
    const raster = rasters[i];
    if (raster) {
      paintRaster(pixels, raster, epsgToUtmZone(sources[i].epsg), tileX, tileY, halfWorldSize);
    }
  }

  return createImageBitmap(new ImageData(new Uint8ClampedArray(data), TILE_SIZE, TILE_SIZE));
}

/**
 * Bilinearly samples every pixel of the tile that isn't already painted out of the raster.
 *
 * Naively each of the 262144 pixels needs an inverse mercator, an llToUtm, and the raster's affine
 * map, which is about ten transcendentals apiece. Nearly all of it is loop invariant: mercator
 * takes latitude from the row alone and longitude from the column alone, and in llToUtm only
 * A = cos(lat) * (lng - lngOrigin) depends on longitude, with A itself linear in the column. So
 * each row computes the latitude-dependent terms once and the inner loop is a polynomial in A.
 *
 * Keep in sync with llToUtm.
 */
function paintRaster(
    out: Uint32Array,
    raster: Raster,
    zone: number,
    tileX: number,
    tileY: number,
    halfWorldSize: number): void {
  //+3 puts origin in middle of zone
  const lngOrigin = ((zone - 1) * 6 - 180 + 3) / 180 * Math.PI;
  const lngBase = Math.PI * (tileX + 0.5 / TILE_SIZE) / halfWorldSize - lngOrigin;
  const lngStep = Math.PI / (TILE_SIZE * halfWorldSize);
  const pixels = raster.pixels;
  const stride = 3 * raster.width;
  const maxX = raster.width - 1;
  const maxY = raster.height - 1;

  for (let yp = 0; yp < TILE_SIZE; ++yp) {
    const mercY = (tileY - 1 + (TILE_SIZE - yp - 0.5) / TILE_SIZE) / halfWorldSize;
    const lat = Math.asin(Math.tanh(mercY * Math.PI));
    const sinLat = Math.sin(lat);
    const cosLat = Math.cos(lat);
    const tanLat = Math.tan(lat);
    const N = EARTH_RADIUS / Math.sqrt(1 - ECC_SQUARED * sinLat * sinLat);
    const T = tanLat * tanLat;
    const C = ECC_PRIME_SQUARED * cosLat * cosLat;
    const M =
        EARTH_RADIUS * (
            M0 * lat
                - M2 * Math.sin(2 * lat)
                + M4 * Math.sin(4 * lat)
                - M6 * Math.sin(6 * lat));

    const aBase = cosLat * lngBase;
    const aStep = cosLat * lngStep;
    const e3 = (1 - T + C) / 6;
    const e5 = (5 - 18 * T + T * T + 72 * C - 58 * ECC_PRIME_SQUARED) / 120;
    const n4 = (5 - T + 9 * C + 4 * C * C) / 24;
    const n6 = (61 - 58 * T + T * T + 600 * C - 330 * ECC_PRIME_SQUARED) / 720;
    // Fold the false easting, the meridional arc, and the raster's affine map into the row so the
    // inner loop only handles the parts that vary with A.
    const xBase = raster.xScale * UTM_FALSE_EASTING + raster.xBias;
    const xScale = raster.xScale * UTM_SCALE * N;
    const yBase =
        raster.yScale * ((lat < 0 ? UTM_FALSE_NORTHING : 0) + UTM_SCALE * M) + raster.yBias;
    const yScale = raster.yScale * UTM_SCALE * N * tanLat;
    const row = yp * TILE_SIZE;

    for (let xp = 0; xp < TILE_SIZE; ++xp) {
      const i = row + xp;
      if (out[i] !== 0) {
        continue;
      }

      const A = aBase + xp * aStep;
      const A2 = A * A;
      const xt = xBase + xScale * A * (1 + A2 * (e3 + A2 * e5));
      const yt = yBase + yScale * A2 * (0.5 + A2 * (n4 + A2 * n6));
      if (xt < 0 || yt < 0 || xt > maxX || yt > maxY) {
        continue;
      }

      const xl = xt | 0; // xt is non-negative, so this is a floor
      const yl = yt | 0;
      const xh = xl < maxX ? xl + 1 : xl;
      const yh = yl < maxY ? yl + 1 : yl;
      const xf = xt - xl;
      const yf = yt - yl;
      const lowRow = yl * stride;
      const highRow = yh * stride;

      let v = 0;
      for (let j = 0; j < 3; ++j) {
        const ll = pixels[lowRow + 3 * xl + j];
        const lr = pixels[lowRow + 3 * xh + j];
        const hl = pixels[highRow + 3 * xl + j];
        const hr = pixels[highRow + 3 * xh + j];
        const l = (1 - xf) * ll + xf * lr;
        const h = (1 - xf) * hl + xf * hr;
        v |= ((1 - yf) * l + yf * h) << (j * 8);
      }

      if (v) {
        out[i] = v | (255 << 24);
      }
    }
  }
}

// Returns undefined when the tile lands entirely outside the source's raster.
async function getRaster(
    feature: Feature, tileLow: S2LatLng, tileHigh: S2LatLng, pool: geotiff.Pool):
        Promise<Raster|undefined> {
  // We need to project all corners because UTM isn't axis-aligned with Mercator and the
  // rotation changes depending on whether you're west or east of the meridian.
  const zone = epsgToUtmZone(feature.epsg);
  const corners = [
    llToUtm(tileLow.latRadians(), tileLow.lngRadians(), zone),
    llToUtm(tileLow.latRadians(), tileHigh.lngRadians(), zone),
    llToUtm(tileHigh.latRadians(), tileLow.lngRadians(), zone),
    llToUtm(tileHigh.latRadians(), tileHigh.lngRadians(), zone),
  ];
  const lowX =
      Math.min(corners[0][0], corners[1][0], corners[2][0], corners[3][0]) - WINDOW_SLACK_METERS;
  const lowY =
      Math.min(corners[0][1], corners[1][1], corners[2][1], corners[3][1]) - WINDOW_SLACK_METERS;
  const highX =
      Math.max(corners[0][0], corners[1][0], corners[2][0], corners[3][0]) + WINDOW_SLACK_METERS;
  const highY =
      Math.max(corners[0][1], corners[1][1], corners[2][1], corners[3][1]) + WINDOW_SLACK_METERS;
  const resX = (highX - lowX) / TILE_SIZE;
  const resY = (highY - lowY) / TILE_SIZE;

  // Image 0 carries the georeferencing for the whole file, so all the transforms reference it even
  // when we sample an overview.
  const images = await overviewsOf(feature);
  const full = images[0];
  const bbox = full.getBoundingBox();
  const fullX = bbox[2] - bbox[0];
  const fullY = bbox[3] - bbox[1];
  let choice = images.length - 1;
  for (; choice > 0; --choice) {
    const c = images[choice];
    if (resX > fullX / c.getWidth() && resY > fullY / c.getHeight()) {
      break;
    }
  }

  const image = images[choice];
  const width = image.getWidth();
  const height = image.getHeight();
  const translatePx = full.pixelIsArea() ? 0 : -0.5;
  const [oX, oY] = full.getOrigin();
  const [sX, sY] = image.getResolution(full);
  // Resolution is negative on whichever axis counts down, so sort the corners rather than assuming
  // which one is the low edge.
  const pxA = (lowX - oX) / sX + translatePx;
  const pxB = (highX - oX) / sX + translatePx;
  const pyA = (lowY - oY) / sY + translatePx;
  const pyB = (highY - oY) / sY + translatePx;
  const window = [
    clamp(Math.floor(Math.min(pxA, pxB)), 0, width),
    clamp(Math.floor(Math.min(pyA, pyB)), 0, height),
    clamp(Math.ceil(Math.max(pxA, pxB)), 0, width),
    clamp(Math.ceil(Math.max(pyA, pyB)), 0, height),
  ];
  if (window[2] <= window[0] || window[3] <= window[1]) {
    return undefined;
  }

  const pixels =
      await retrying(() => image.readRasters({
        interleave: true,
        pool,
        window,
      }) as Promise<Uint8Array>);
  return {
    xScale: 1 / sX,
    xBias: -oX / sX + translatePx - window[0],
    yScale: 1 / sY,
    yBias: -oY / sY + translatePx - window[1],
    pixels,
    width: window[2] - window[0],
    height: window[3] - window[1],
  };
}

function overviewsOf(feature: Feature): Promise<GeoTIFFImage[]> {
  if (!feature.images) {
    feature.images = readOverviews(checkExists(feature.visual));
  }
  return feature.images;
}

async function readOverviews(source: GeoTIFF): Promise<GeoTIFFImage[]> {
  const first = await source.getImage(0);
  const overviews = [];
  const count = await source.getImageCount();
  for (let i = 1; i < count; ++i) {
    const image = await source.getImage(i);
    const fd = image.getFileDirectory();
    if (fd.SubfileType === 2 || (fd.NewSubfileType & 1) === 1) {
      overviews.push(image);
    }
  }

  overviews.sort((a, b) => b.getWidth() - a.getWidth());
  return [first, ...overviews];
}

/**
 * Adapted from
 * https://github.com/shahid28/utm-latlng/blob/777679b649413ca967905d9ea7afe7234a45b25e/UTMLatLng.js
 *
 * MIT License
 *
 * Copyright (c) 2016-2019 utm-latlng author
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
function llToUtm(lat: number, lng: number, zone: number): [number, number] {
  // Technically we need to do this but I don't care. Don't feel like converting all of these
  // numbers to radians.
  //
  // if (longitude >= 8 && longitude <= 13 && latitude > 54.5 && latitude < 58) {
  //   zone = 32;
  // } else if (latitude >= 56.0 && latitude < 64.0 && longitude >= 3.0 && longitude < 12.0) {
  //   zone = 32;
  // } else {
  //   zone = ((longitude + 180) / 6) + 1;

  //   if (latitude >= 72.0 && latitude < 84.0) {
  //     if (longitude >= 0.0 && longitude < 9.0) {
  //       zone = 31;
  //     } else if (longitude >= 9.0 && longitude < 21.0) {
  //       zone = 33;
  //     } else if (longitude >= 21.0 && longitude < 33.0) {
  //       zone = 35;
  //     } else if (longitude >= 33.0 && longitude < 42.0) {
  //       zone = 37;
  //     }
  //   }
  // }

  //+3 puts origin in middle of zone
  const longitudeOrigin = ((zone - 1) * 6 - 180 + 3) / 180 * Math.PI;

  const N = EARTH_RADIUS / Math.sqrt(1 - ECC_SQUARED * Math.sin(lat) * Math.sin(lat));
  const T = Math.tan(lat) * Math.tan(lat);
  const C = ECC_PRIME_SQUARED * Math.cos(lat) * Math.cos(lat);
  const A = Math.cos(lat) * (lng - longitudeOrigin);

  const M =
      EARTH_RADIUS * (
          M0 * lat
              - M2 * Math.sin(2 * lat)
              + M4 * Math.sin(4 * lat)
              - M6 * Math.sin(6 * lat));

  const easting =
      UTM_FALSE_EASTING + UTM_SCALE * N * (
          A + (1 - T + C) * A * A * A / 6
              + (5 - 18 * T + T * T + 72 * C - 58 * ECC_PRIME_SQUARED) * A * A * A * A * A / 120);
  const northing =
      (lat < 0 ? UTM_FALSE_NORTHING : 0) +
          UTM_SCALE * (
              M + N * Math.tan(lat) * (
                  A * A / 2
                      + (5 - T + 9 * C + 4 * C * C) * A * A * A * A / 24
                      + (61 - 58 * T + T * T + 600 * C - 330 * ECC_PRIME_SQUARED)
                      * A * A * A * A * A * A / 720));
  return [easting, northing];
}

self.onmessage = e => {
  const request = e.data as Request;
  if (request.kind !== 'ir') {
    throw new Error('Expected an initialization request');
  }

  start(request);
};
