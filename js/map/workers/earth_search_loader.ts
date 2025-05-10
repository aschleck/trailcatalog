import * as geotiff from 'geotiff';
import { GeoTIFF } from 'geotiff';

import { S1Angle, S2LatLng, S2LatLngRect, S2Point, S2Polygon } from 'java/org/trailcatalog/s2';
import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';
import { checkExhaustive, checkExists } from 'external/dev_april_corgi+/js/common/asserts';
import { HashMap, HashSet } from 'external/dev_april_corgi+/js/common/collections';
import { Debouncer } from 'external/dev_april_corgi+/js/common/debouncer';
import { clamp } from 'external/dev_april_corgi+/js/common/math';

import { projectLatLngRect, unprojectS2LatLng } from '../camera';
import { tilesIntersect } from '../common/math';
import { TileId, Vec2 } from '../common/types';

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
      scl: {
        href: string;
        'proj:shape': string;
        'proj:transform': string;
        type: string;
      };
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
  loading: Promise<unknown>|undefined;
  scl: GeoTIFF|undefined;
  sclUrl: string;
  visual: GeoTIFF|undefined;
  visualUrl: string;
}

const MIN_ZOOM = 7;
const MAX_ZOOM = 15;
const RESULTS_LIMIT = 1024;
const TILE_SIZE = 512;

class EarthSearchLoader {

  private readonly activeFeatures: Feature[];
  private readonly dataChangedDebouncer: Debouncer;
  private readonly geotiffPool: geotiff.Pool;
  private readonly loaded: HashSet<TileId>;
  private activeQuery: Promise<void>|undefined;
  private lastQuery: S2LatLngRect;
  private lastRequest: UpdateViewportRequest;

  constructor(
      private readonly collection: string,
      private readonly daysToFetch: number,
      private readonly query: object,
      private readonly postMessage: (command: Command, transfer?: Transferable[]) => void,
  ) {
    this.activeFeatures = [];
    this.dataChangedDebouncer = new Debouncer(/* delayMs= */ 100, () => {
      this.updateViewport(this.lastRequest);
    });
    this.geotiffPool = new geotiff.Pool();
    this.loaded = createTileHashSet();
    this.activeQuery = undefined;
    this.lastQuery = S2LatLngRect.empty();
    this.lastRequest = {
      kind: 'uvr',
      viewport: {
        lat: [1, -1],
        lng: [1, -1],
        zoom: 31,
      },
    };
  }

  updateViewport(request: UpdateViewportRequest): void {
    if (request.viewport.zoom < MIN_ZOOM) {
      return;
    }

    this.lastRequest = request;
    const viewport =
        S2LatLngRect.fromPointPair(
            S2LatLng.fromRadians(request.viewport.lat[0], request.viewport.lng[0]),
            S2LatLng.fromRadians(request.viewport.lat[1], request.viewport.lng[1]));
    const zoom = clamp(Math.floor(request.viewport.zoom), 0, MAX_ZOOM);

    // Idk whatever
    if (this.activeQuery) {
      this.dataChangedDebouncer.trigger();
      return;
    }

    this.postMessage({
      kind: 'usc',
      fetching: true,
    });

    let queryPromise;
    if (this.lastQuery.contains(viewport)) {
      queryPromise = Promise.resolve();
    } else {
      queryPromise = this.queryForFeatures(viewport, request.viewport.zoom);
      this.activeQuery = queryPromise;
    }

    queryPromise.then(() => {
      return this.tileViewport(viewport, zoom);
    }).then(() => {
      // We don't abort requests in this layer which is kind of fubar but whatever I hate this
      this.activeQuery = undefined;
    });
  }

  private async tileViewport(viewport: S2LatLngRect, zoom: number): Promise<void> {
    const halfWorldSize = Math.pow(2, zoom - 1);

    let projected = projectLatLngRect(viewport);
    if (projected.low[0] > projected.high[0]) {
      projected = {
        low: [projected.high[0], projected.low[1]],
        high: [projected.low[0], projected.high[1]],
      };
    }

    let allPresent = true;
    const promises = [];
    const used = createTileHashSet();
    for (let y = Math.ceil(halfWorldSize * projected.low[1]);
         y < halfWorldSize * projected.high[1] + 1;
         ++y) {
      for (let x = Math.floor(halfWorldSize * projected.low[0]);
          x < halfWorldSize * projected.high[0];
          ++x) {
        const tileId = {x: x + halfWorldSize, y: halfWorldSize - y, zoom};
        used.add(tileId);
        if (this.loaded.has(tileId)) {
          continue;
        }

        const tileLow = unprojectS2LatLng(x / halfWorldSize, (y - 1) / halfWorldSize);
        const tileHigh = unprojectS2LatLng((x + 1) / halfWorldSize, (y + 0) / halfWorldSize);
        const bound = S2LatLngRect.fromPointPair(tileLow, tileHigh);
        const asList = SimpleS2.newArrayList<S2Point>();
        asList.add(tileLow.toPoint());
        asList.add(S2LatLng.fromRadians(tileLow.latRadians(), tileHigh.lngRadians()).toPoint());
        asList.add(tileHigh.toPoint());
        asList.add(S2LatLng.fromRadians(tileHigh.latRadians(), tileLow.lngRadians()).toPoint());
        const polygon = SimpleS2.pointsToPolygon(asList);

        const choices = [];
        let have = SimpleS2.newPolygon();
        const oneE7 = S1Angle.e7(1);
        for (const feature of this.activeFeatures) {
          if (!feature.bound.intersects(bound)) {
            continue;
          }

          if (!feature.polygon.intersects(polygon)) {
            continue;
          }

          const garbage1 = SimpleS2.newPolygon();
          const garbage2 = SimpleS2.newPolygon();
          garbage1.initToIntersection(polygon, feature.polygon);
          garbage2.initToUnion(have, garbage1);
          if (garbage2.getArea() > 1.1 * have.getArea()) {
            choices.push(feature);
            have = garbage2;
          }
        }

        // We may just not have the data yet. There's probably an edge case where we have one asset
        // for a point but none of the assets just barely in view.
        if (choices.length < 1) {
          continue;
        }

        let present = true;
        for (const choice of choices) {
          if (!choice.loading) {
            choice.loading = geotiff.fromUrl(choice.visualUrl).then(v => {
              choice.visual = v;
              this.dataChangedDebouncer.trigger();
            });
            present = false;
          }

          if (!choice.visual) {
            present = false;
          }
        }

        if (!present) {
          allPresent = false;
          continue;
        }

        this.loaded.add(tileId);

        promises.push(
            drawTile(x, y, halfWorldSize, choices, tileLow, tileHigh, this.geotiffPool).then(
                bitmap => {
                  this.postMessage({
                    kind: 'ltc',
                    id: tileId,
                    bitmap: bitmap,
                  }, [bitmap]);
                }));
      }
    }

    await Promise.all(promises);

    if (allPresent) {
      this.postMessage({
        kind: 'usc',
        fetching: false,
      });

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
  }

  private queryForFeatures(viewport: S2LatLngRect, zoom: number): Promise<void> {
    const size = viewport.getSize();
    const expanded = viewport.expanded(size);
    this.lastQuery = expanded;
    const low = expanded.lo();
    const high = expanded.hi();
    const width = (256 * Math.pow(2, zoom)) / 360 * size.lngDegrees();
    const height = (256 * Math.pow(2, zoom)) / 180 * size.latDegrees();
    const bbox = [
      viewport.lo().lngDegrees(),
      viewport.lo().latDegrees(),
      viewport.hi().lngDegrees(),
      viewport.hi().latDegrees(),
    ];

    const now = new Date();
    const was = new Date();
    was.setDate(now.getDate() - this.daysToFetch);
    return fetch('https://earth-search.aws.element84.com/v1/search?' + new URLSearchParams({
      datetime: `${was.toISOString()}/${now.toISOString()}`,
      limit: '200',
      collections: this.collection,
      bbox: `${low.lngDegrees()},${low.latDegrees()},${high.lngDegrees()},${high.latDegrees()}`,
      query: JSON.stringify(this.query),
      sortby: '-properties.datetime',
    }))
        .then(response => response.json() as Promise<EarthSearchFeatureCollection>)
        .then(response => {
          // TODO(april): unload stuff
          this.activeFeatures.length = 0;
          return this.processFeatures(response, RESULTS_LIMIT);
        });
  }

  private processFeatures(response: EarthSearchFeatureCollection, limit: number): Promise<void> {
    for (const feature of response.features) {
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
      const polygon = SimpleS2.pointsToPolygon(asList);

      this.activeFeatures.push({
        id: feature.id,
        bound,
        epsg: feature.properties['proj:epsg'],
        polygon,
        loading: undefined,
        scl: undefined,
        sclUrl: feature.assets.scl.href,
        visual: undefined,
        visualUrl: feature.assets.visual.href,
      });
    }

    const remaining = limit - response.features.length;
    if (remaining > 0) {
      for (const link of response.links) {
        if (link.rel === "next") {
          return fetch(link.href)
              .then(response => response.json() as Promise<EarthSearchFeatureCollection>)
              .then(response => this.processFeatures(response, remaining));
        }
      }
    }
    return Promise.resolve();
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
        x: number,
        y: number,
        halfWorldSize: number,
        sources: Feature[],
        tileLow: S2LatLng,
        tileHigh: S2LatLng,
        pool: geotiff.Pool):
    Promise<ImageBitmap> {
  const windows =
      sources.map(s => getRaster(checkExists(s.visual), tileLow, tileHigh, s.epsg, pool));
  const data = new ArrayBuffer(TILE_SIZE * TILE_SIZE * 4);
  const uint32s = new Uint32Array(data);
  let last = Promise.resolve();
  for (let i = windows.length - 1; i >= 0; --i) {
    last = last.then(() => windows[i].then(([nd, project, source]) => {
      const zone = epsgToUtmZone(sources[i].epsg);
      for (let yp = 0; yp < TILE_SIZE; ++yp) {
        for (let xp = 0; xp < TILE_SIZE; ++xp) {
          const ll =
              unprojectS2LatLng(
                  (x + (xp + 0.5) / TILE_SIZE) / halfWorldSize,
                  (y - 1 + (TILE_SIZE - yp + 0.5) / TILE_SIZE) / halfWorldSize);
          const [xt, yt] = project(llToUtm(ll.latRadians(), ll.lngRadians(), zone));

          const i = yp * TILE_SIZE + xp;
          const xl = Math.floor(xt);
          const xh = Math.min(Math.ceil(xt), source.width);
          const xf = xt - xl;
          const yl = Math.floor(yt);
          const yh = Math.min(Math.ceil(yt), source.height);
          const yf = yt - yl;

          // Bilinear
          let v = 0;
          for (let j = 0; j < 3; ++j) {
            const bl = source[3 * (yl * source.width + xl) + j];
            const br = source[3 * (yl * source.width + xh) + j];
            const tl = source[3 * (yh * source.width + xl) + j];
            const tr = source[3 * (yh * source.width + xh) + j];
            const ch = (1 - xf) * tl + xf * tr;
            const cl = (1 - xf) * bl + xf * br;
            v |= ((1 - yf) * cl + yf * ch) << (j * 8);
          }

          if (v) {
            uint32s[i] = v | (255 << 24);
          }
        }
      }
    }));
  }

  await last;
  return createImageBitmap(new ImageData(new Uint8ClampedArray(data), TILE_SIZE, TILE_SIZE));
}

async function getRaster(
    source: GeoTIFF, tileLow: S2LatLng, tileHigh: S2LatLng, epsg: number, pool: geotiff.Pool):
        Promise<[
          number|null,
          (utm: Vec2) => Vec2,
          Uint8Array & {width: number; height: number},
        ]> {
  // We need to project all corners because UTM isn't axis-aligned with Mercator and the
  // rotation changes depending on whether you're west or east of the meridian.
  const zone = epsgToUtmZone(epsg);
  const tileCorners = [
    llToUtm(tileLow.latRadians(), tileLow.lngRadians(), zone),
    llToUtm(tileLow.latRadians(), tileHigh.lngRadians(), zone),
    llToUtm(tileHigh.latRadians(), tileLow.lngRadians(), zone),
    llToUtm(tileHigh.latRadians(), tileHigh.lngRadians(), zone),
  ];
  const tileUtmLow = [
    Math.min(tileCorners[0][0], tileCorners[1][0], tileCorners[2][0], tileCorners[3][0]) - 100,
    Math.min(tileCorners[0][1], tileCorners[1][1], tileCorners[2][1], tileCorners[3][1]) - 100,
  ];
  const tileUtmHigh = [
    Math.max(tileCorners[0][0], tileCorners[1][0], tileCorners[2][0], tileCorners[3][0]) + 100,
    Math.max(tileCorners[0][1], tileCorners[1][1], tileCorners[2][1], tileCorners[3][1]) + 100,
  ];
  const resX = (tileUtmHigh[0] - tileUtmLow[0]) / TILE_SIZE;
  const resY = (tileUtmHigh[1] - tileUtmLow[1]) / TILE_SIZE;

  const first = await source.getImage(0);
  const options = [first];
  for (let i = 1; i < await source.getImageCount(); ++i) {
    const image = await source.getImage(i);
    const fd = image.getFileDirectory();
    if (fd.SubfileType === 2 || (fd.NewSubfileType & 1) === 1) {
      options.push(image);
    }
  }
  options.sort((a, b) => b.getWidth() - a.getWidth());

  let choice = options.length - 1;
  const imageBbox = first.getBoundingBox();
  const imageSize = [imageBbox[2] - imageBbox[0], imageBbox[3] - imageBbox[1]];
  for (; choice > 0; --choice) {
    const c = options[choice];
    if (resX > imageSize[0] / c.getWidth() && resY > imageSize[1] / c.getHeight()) {
      break;
    }
  }

  const image = options[choice];
  const translatePx = first.pixelIsArea() ? 0 : -0.5;
  const [oX, oY, oZ] = first.getOrigin();
  const [sX, sY, sZ] = image.getResolution(first);
  const window = [
    Math.floor((tileUtmLow[0] - oX) / sX + translatePx),
    Math.floor((tileUtmHigh[1] - oY) / sY + translatePx),
    Math.ceil((tileUtmHigh[0] - oX) / sX + translatePx),
    Math.ceil((tileUtmLow[1] - oY) / sY + translatePx),
  ];
  return Promise.all([
    image.getGDALNoData(),
    ([utmX, utmY]: Vec2) => [
      (utmX - oX) / sX + translatePx - window[0],
      (utmY - oY) / sY + translatePx - window[1],
    ],
    image.readRasters({
      interleave: true,
      pool,
      // TODO(april): this generates images with huge black areas because we don't clamp to image
      // size
      window,
    }) as Promise<Uint8Array & {width: number; height: number}>,
  ]);
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

  const a = 6378137;
  const eccSquared = 0.00669438;

  //+3 puts origin in middle of zone
  const longitudeOrigin = ((zone - 1) * 6 - 180 + 3) / 180 * Math.PI;
  const eccPrimeSquared = (eccSquared) / (1 - eccSquared);

  const N = a / Math.sqrt(1 - eccSquared * Math.sin(lat) * Math.sin(lat));
  const T = Math.tan(lat) * Math.tan(lat);
  const C = eccPrimeSquared * Math.cos(lat) * Math.cos(lat);
  const A = Math.cos(lat) * (lng - longitudeOrigin);

  const M = a * ((1 - eccSquared / 4 - 3 * eccSquared * eccSquared / 64 - 5 * eccSquared * eccSquared * eccSquared / 256) * lat
      - (3 * eccSquared / 8 + 3 * eccSquared * eccSquared / 32 + 45 * eccSquared * eccSquared * eccSquared / 1024) * Math.sin(2 * lat)
      + (15 * eccSquared * eccSquared / 256 + 45 * eccSquared * eccSquared * eccSquared / 1024) * Math.sin(4 * lat)
      - (35 * eccSquared * eccSquared * eccSquared / 3072) * Math.sin(6 * lat));

  const easting =
      500000.0 + 0.9996 * N * (
          A + (1 - T + C) * A * A * A / 6
              + (5 - 18 * T + T * T + 72 * C - 58 * eccPrimeSquared) * A * A * A * A * A / 120);
  const northing =
      (lat < 0 ? 10000000.0 : 0) +
          0.9996 * (
              M + N * Math.tan(lat) * (
                  A * A / 2
                      + (5 - T + 9 * C + 4 * C * C) * A * A * A * A / 24
                      + (61 - 58 * T + T * T + 600 * C - 330 * eccPrimeSquared)
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

