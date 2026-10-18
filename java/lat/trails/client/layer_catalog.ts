import { Disposable } from 'external/dev_april_corgi+/js/common/disposable';
import { Timer } from 'external/dev_april_corgi+/js/common/timer';

import { Camera } from 'js/map/camera';
import { COPERNICUS_DEM_COPYRIGHT, MAPTERHORN_COPYRIGHT, NASADEM_COPYRIGHT, OSM_COPYRIGHT, PROTOMAPS_COPYRIGHT } from 'js/map/common/copyrights';
import { Copyright, RgbaU32 } from 'js/map/common/types';
import { CompositeLayer } from 'js/map/layers/composite_layer';
import { CONTOURS_FEET, CONTOURS_METERS, MbtileLayer } from 'js/map/layers/mbtile_layer';
import { RasterTileLayer } from 'js/map/layers/raster_tile_layer';
import { SlopeLayer } from 'js/map/layers/slope_layer';
import { StacLayer } from 'js/map/layers/stac_layer';
import { WindVectorLayer } from 'js/map/layers/wind_vector_layer';
import { Renderer } from 'js/map/rendering/renderer';
import { LocationIndex } from 'js/map/workers/location_index';
import { Style } from 'js/map/workers/mbtile_loader';
import { Decode } from 'js/map/workers/raster_loader';
import { Stream } from 'js/map/workers/s2_data_fetcher';
import { Bands, Channel, Search } from 'js/map/workers/stac_loader';
import { BASE_ZOOM as TERRARIUM_BASE_ZOOM, TILE_URL as TERRARIUM_TILE_URL } from 'js/map/workers/terrarium';
import { ECMWF_LAYERS, EcmwfLayer, WEATHER_VIEWS, WeatherView } from 'js/map/workers/weather';
import { Z_BASE_ELEVATION, Z_BASE_SATELLITE, Z_BASE_SLOPE, Z_BASE_TERRAIN, Z_OVERLAY_TERRAIN } from 'js/map/z';
import { getUnitSystem, UnitSystem } from 'js/units/formatters';

import { CollectionLayer } from './collection_layer';
import {
  ControlValues,
  LayerEntry,
  LayerGroup,
  layerEntries,
  LayerNode,
  sortLayerNodes,
} from './layer_tree';
import { PointCollectionLayer } from './point_collection_layer';
import { readElevation, readSnodas, readWeather } from './readings';
import { OSM_NODES_SCHEMA, OSM_WAYS_SCHEMA } from './schema';
import {
  BASEMAP_LABEL_KINDS,
  basemapOf,
  NATURE_WITHOUT_DETAILED_WAYS,
  NODE_KINDS,
  OSM_WAYS,
  osmWaysOf,
  WAY_KINDS,
} from './styles';

const CC_BY_4 = {name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/'};
// ECMWF's terms dictate the wording, the note that we modified the data, and the disclaimer.
// https://apps.ecmwf.int/datasets/licences/general/
const ECMWF_COPYRIGHT: Copyright = {
  long:
      'Based on data and products of the European Centre for Medium-Range Weather Forecasts '
          + '(ECMWF), retiled and modified by trails.lat. ECMWF does not accept any liability '
          + 'whatsoever for any error or omission in the data.',
  short: 'ECMWF',
  url: 'https://www.ecmwf.int/en/forecasts/datasets/open-data',
  license: CC_BY_4,
};
// Keep in sync with ecmwf.sh, which writes ecmwf_<run>_<layer>_<step>.pmtiles
const ECMWF_URL = 'https://tiles.trailcatalog.org/ecmwf_';
// See Weather.kt#maxStep
const ECMWF_MAX_STEP = 144;
// ECMWF starts a run every 6 hours.
const ECMWF_CYCLE_HOURS = 6;
const HOUR_MS = 60 * 60 * 1000;
// ECMWF tiles a run every 6 hours and its step closest to now moves every 3, so we check hourly.
const CONDITIONS_REFRESH_MS = HOUR_MS;
// NSIDC makes citing the data set a condition of using it.
const SNODAS_COPYRIGHT: Copyright = {
  long:
      'National Operational Hydrologic Remote Sensing Center. 2004. Snow Data Assimilation System '
          + '(SNODAS) Data Products at NSIDC, Version 1. Boulder, Colorado USA. NSIDC.',
  short: 'NOAA NOHRSC',
  url: 'https://doi.org/10.7265/N5TB14TC',
  publicDomain: true,
};
// openAIP's license allows shipping its data in an app as long as the data itself isn't what's
// sold.
// https://www.openaip.net/
const OPENAIP_COPYRIGHT: Copyright = {
  long: 'Aeronautical data from openAIP, not for navigation',
  short: 'openAIP',
  url: 'https://www.openaip.net/',
  license: {name: 'CC BY-NC 4.0', url: 'https://creativecommons.org/licenses/by-nc/4.0/'},
};
// The FAA asks for acknowledgement in products that use its charts.
const FAA_COPYRIGHT: Copyright = {
  long: 'Sectional Aeronautical Charts from FAA Aeronautical Information Services',
  short: 'FAA',
  url: 'https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/vfr/',
  publicDomain: true,
};
// Keep in sync with faa_sectional.py, which writes one archive per cycle named
// faa_sectional_<cycle>.pmtiles
const FAA_SECTIONAL_URL = 'https://tiles.trailcatalog.org/faa_sectional_';
// Charts take effect at 0901 UTC on the first day of their cycle. See
// faa_sectional.py#CYCLE_EPOCH.
const FAA_CYCLE_EPOCH_MS = Date.UTC(2026, 8, 3, 9, 1);
const FAA_CYCLE_DAYS = 56;
const FAA_SECTIONAL_ID = 'us/faa_sectional';
const SWISSTOPO_COPYRIGHT: Copyright = {
  long: 'Federal Office of Topography swisstopo',
  short: 'swisstopo',
  url: 'https://www.swisstopo.admin.ch/en/terms-of-use-free-geodata-and-geoservices',
};
// Sentinel-1A's first imagery is from October 2014
const SENTINEL_1_FIRST_YEAR = 2014;
// Sentinel-2A launched in June 2015
const SENTINEL_2_FIRST_YEAR = 2015;
// Cloud shadows, medium and high probability clouds, and cirrus in the scene classification
// https://docs.sentinel-hub.com/api/latest/data/sentinel-2-l2a/
const SENTINEL_2_MASK = {asset: 'scl', hidden: [3, 8, 9, 10]};
const SENTINEL_2_TRUE_COLOR: [Channel, Channel, Channel] =
    [byteSample('visual', 0), byteSample('visual', 1), byteSample('visual', 2)];
// Keyed by the value of the Sentinel-2 entry's bands control. sentinel2Bands adds the mask.
const SENTINEL_2_BANDS: {[key: string]: Bands} = {
  true_color: {channels: SENTINEL_2_TRUE_COLOR},
  // https://custom-scripts.sentinel-hub.com/custom-scripts/sentinel-2/swir-rgb/
  swir: {channels: [reflectance('swir22'), reflectance('nir08'), reflectance('red')]},
  // https://custom-scripts.sentinel-hub.com/custom-scripts/sentinel-2/false_color_infrared/
  infrared: {channels: [reflectance('nir'), reflectance('red'), reflectance('green')]},
  // https://custom-scripts.sentinel-hub.com/custom-scripts/sentinel-2/ndvi/
  ndvi: {
    channels: [normalizedDifference('nir', 'red')],
    palette: [
      [-0.5, 0x0c0c0c],
      [-0.2, 0xbfbfbf],
      [-0.1, 0xdbdbdb],
      [0, 0xeaeaea],
      [0.025, 0xfff9cc],
      [0.05, 0xede8b5],
      [0.075, 0xddd89b],
      [0.1, 0xccc682],
      [0.125, 0xbcb76b],
      [0.15, 0xafc160],
      [0.175, 0xa3cc59],
      [0.2, 0x91bf51],
      [0.25, 0x7fb247],
      [0.3, 0x70a33f],
      [0.35, 0x609635],
      [0.4, 0x4f892d],
      [0.45, 0x3f7c23],
      [0.5, 0x306d1c],
      [0.55, 0x216011],
      [0.6, 0x0f540a],
      [1, 0x004400],
    ].map(([at, color]) => ({at: indexByte(at), color})),
  },
  // https://custom-scripts.sentinel-hub.com/custom-scripts/sentinel-2/ndsi/
  ndsi: {
    channels: SENTINEL_2_TRUE_COLOR,
    highlight: {
      channel: normalizedDifference('green', 'swir16'),
      min: indexByte(0.42),
      color: 0x00ccff,
    },
  },
  // https://custom-scripts.sentinel-hub.com/custom-scripts/sentinel-2/scene-classification/
  scl: {
    channels: [{...byteSample('scl', 0), nearest: true}],
    palette: [
      0x000000, // no data
      0xff0000, // saturated or defective
      0x2f2f2f, // dark area or topographic shadow
      0x643200, // cloud shadow
      0x00a000, // vegetation
      0xffe65a, // not vegetated
      0x0000ff, // water
      0x808080, // unclassified
      0xc0c0c0, // cloud, medium probability
      0xffffff, // cloud, high probability
      0x64c8ff, // thin cirrus
      0xff96ff, // snow or ice
    ].map((color, at) => ({at, color})),
  },
};
// Backscatter mostly runs from -25 to 0 dB in VV and -30 to -5 dB in VH, and their ratio from 0 to
// 15 dB.
const SENTINEL_1_BANDS: Bands = {
  channels: [
    decibels('vv', undefined, -25, 0),
    decibels('vh', undefined, -30, -5),
    decibels('vv', 'vh', 0, 15),
  ],
};
// Keep in sync with snodas.sh, which writes one archive per day named snodas_<day>.pmtiles
const SNODAS_URL = 'https://tiles.trailcatalog.org/snodas_';
// NSIDC posts every day, so a newest day older than yesterday means snodas.sh stopped tiling. We
// reach back far enough to ride out a couple of days of that.
const SNODAS_LOOKBACK_DAYS = 3;
// Runs land 6 to 9 hours after they start, and past that a stale run means ecmwf.sh stopped
// tiling. A 3 day old run still forecasts now, so we reach back that far.
const ECMWF_LOOKBACK_CYCLES = 12;
const SNOW_DEPTH_ID = 'us/conditions/snow_depth';
const SNOW_WATER_ID = 'us/conditions/snow_water';
// Keep in sync with Conditions.kt
const AIR_QUALITY_COLLECTION_ID = '09afe7ea-ffe9-41b3-ac05-580758a5ac2f';
const BURNT_AREAS_COLLECTION_ID = 'c0e8127d-7dd0-4eca-83e8-19a3abda8620';
const EUROPEAN_AIR_QUALITY_COLLECTION_ID = '51787c46-2a9e-4374-b26a-50b7475608e1';
const FIRE_PERIMETERS_COLLECTION_ID = '77ac6377-5725-40bb-bfb5-c0bbcb353617';
const RIVER_GAUGES_COLLECTION_ID = 'b94ce6bf-753b-4886-8dde-224d5ebcfb7a';
// Keep in sync with AviationVectors.kt
const AIRSPACE_COLLECTION_ID = '6febd392-9760-431a-aa30-fa5b0dfcc411';
const AIRPORTS_COLLECTION_ID = 'c885dc7e-291d-4628-bc8b-7f63231b087a';
const NAVAIDS_COLLECTION_ID = '73c9b4f8-720b-407d-a503-736dfca2490f';
const REPORTING_POINTS_COLLECTION_ID = '44fc1319-eae1-4051-8b07-6b1ad24e8861';
const WEATHER_STATIONS_COLLECTION_ID = '1710b392-414f-4945-b8d3-3c1e13a5436e';
// Where trailcatalog starts drawing its points, see trail_layer.ts#RENDER_POINT_ZOOM_THRESHOLD
const POINT_ICON_ZOOM = 14;

/** The map layers we offer besides a collection's own features. */
export class LayerCatalog extends Disposable {

  readonly contours: Record<UnitSystem, MbtileLayer>;
  // What the layer tree starts as
  readonly nodes: LayerNode[];
  // The start of the newest ECMWF run we know is tiled, in ms
  private ecmwfRun: number;
  // The newest SNODAS day we know is tiled
  private snodasDay: string;
  // The newest FAA cycle in effect that we know is tiled
  private faaCycle: string;
  private readonly conditionsRefresh: Timer;

  constructor(
      locations: LocationIndex,
      private readonly camera: Camera,
      private readonly renderer: Renderer,
      // The tree as the viewer holds it, whose values a newer run or day reconfigures with
      private readonly current: () => LayerNode[]) {
    super();
    // We start on the current run and day, and showLatestWeather and showLatestSnow fall back to
    // older ones when those aren't tiled yet.
    const cycleMs = ECMWF_CYCLE_HOURS * HOUR_MS;
    this.ecmwfRun = Math.floor(Date.now() / cycleMs) * cycleMs;
    this.snodasDay = utcDay(0);
    this.faaCycle = faaCycle(0);
    this.conditionsRefresh = new Timer(CONDITIONS_REFRESH_MS, () => {
      this.showLatestSectional();
      this.showLatestSnow();
      this.showLatestWeather();
    });
    this.registerDisposable(this.conditionsRefresh);

    this.contours = {
      imperial: this.newContourLayer(CONTOURS_FEET),
      metric: this.newContourLayer(CONTOURS_METERS),
    };

    const ways =
        new CollectionLayer(
            [OSM_COPYRIGHT],
            '/api/collections/00000000-0000-0000-0000-000000000001',
            OSM_WAYS,
            [
              // Snap to about a pixel at each zoom, which is level z + 6. A level L cell's half
              // diagonal is 0.388 * 2^-L in Mercator units and a pixel at zoom z is 2^-(z+7).
              //
              // This is where most of the geometry goes: consecutive OSM nodes on a path sit about
              // 15 m apart, against 38 m to the pixel at zoom 12.
              //
              // One band per zoom is cheap because zooming out reuses what is already held. Only
              // zooming in asks for a finer snap, and a finer snap is a different URL.
              {minZoom: 0, snap: 16},
              {minZoom: 11, snap: 17},
              {minZoom: 12, snap: 18},
              {minZoom: 13, snap: 19},
              {minZoom: 14, snap: 20},
              {minZoom: 15, snap: undefined},
            ],
            [
              // Tile at zoom - 2, which holds requests near 50 and offscreen reach near 5x at every
              // zoom. Requests go as the viewport divided by the tile and reach goes as the tile
              // divided by the viewport, so a fixed bottom loses at one end or the other: bottom 11
              // costs 903 requests at zoom 10 and reaches 30x at zoom 15.
              //
              // Only the tiling moves between bands. They all carry levels 11 and deeper, so
              // crossing a zoom boundary can never leave a level uncovered.
              //
              // Level 9 is the coarsest safe tiling. The worst level 9 cell on the planet is
              // central Berlin at 221k paths for 3.7 MB, against 94k at level 10 and 34k at level
              // 11.
              {minZoom: 10, maxZoom: 12, indexBottom: 9, fromLevel: 11, toLevel: undefined},
              {minZoom: 12, maxZoom: 14, indexBottom: 10, fromLevel: 11, toLevel: undefined},
              {minZoom: 14, maxZoom: undefined, indexBottom: 11, fromLevel: 11, toLevel: undefined},
              // Carry the long ways separately, or a river keeps its short ways and loses the long
              // stretches of its mainstem. A way is assigned to the smallest cell containing it and
              // a range query only reaches cells at or below its own level, so nothing above can
              // pick these up. 153k paths sit above level 10, 42% of them waterways, and the share
              // climbs with length: 87 of the 101 paths at level 4.
              //
              // Tile the two ends differently because they cost differently. Levels 0 to 8 are
              // rare enough for level 4, where the worst tile on the planet holds 188 and a real
              // one runs about 25 kb. Levels 9 and 10 are 25x more numerous, so they need level 7
              // for 9 to 42 kb against the 1.5 MB a level 4 tile of them costs.
              //
              // fromLevel 0 buys the 18 ways above level 4 for 8 to 19 ancestor requests a
              // viewport. They are ferry routes and a rail line, and a layer that draws every way
              // draws those.
              {minZoom: 10, maxZoom: undefined, indexBottom: 4, fromLevel: 0, toLevel: 8},
              {minZoom: 10, maxZoom: undefined, indexBottom: 7, fromLevel: 9, toLevel: 10},
            ],
            locations,
            this.camera,
            this.renderer,
        );
    const osmNodes =
        new PointCollectionLayer(
            [OSM_COPYRIGHT],
            '/api/collections/00000000-0000-0000-0000-000000000002',
            [
              // Every point sits in a level 13 cell, see DumpPoints.kt. Level 11 tiles hold a
              // viewport at zoom 14 in a handful of requests.
              {minZoom: POINT_ICON_ZOOM, maxZoom: undefined, indexBottom: 11, fromLevel: 13,
                toLevel: 13},
            ],
            NODE_KINDS.map(({category}) => category),
            POINT_ICON_ZOOM,
            this.camera,
            this.renderer,
        );
    const protomaps =
        new MbtileLayer(
            [PROTOMAPS_COPYRIGHT],
            'https://api.protomaps.com/tiles/v4/${id.zoom}/${id.x}/${id.y}.mvt?key=b6ce0acec3807d5c',
            NATURE_WITHOUT_DETAILED_WAYS,
            /* extraZoom= */ 0,
            /* minZoom= */ 0,
            /* maxZoom= */ 15,
            this.renderer,
        );
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
    const sentinelValues = {
      bands: 'true_color',
      fill_clouds: true,
      from: isoDay(fiveDaysAgo),
      to: isoDay(new Date()),
      cloud: 50,
    };
    const sentinel =
        new StacLayer(
            {
              searchUrl: 'https://earth-search.aws.element84.com/v1/search',
              collection: 'sentinel-2-c1-l2a',
            },
            sentinelSearch(sentinelValues),
            sentinel2Bands(sentinelValues),
            SENTINEL_2_FIRST_YEAR,
            copernicusCredit,
            Z_BASE_SATELLITE,
            this.renderer);
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const sentinel1Values = {from: isoDay(weekAgo), to: isoDay(new Date())};
    const sentinel1 =
        new StacLayer(
            {
              searchUrl: 'https://planetarycomputer.microsoft.com/api/stac/v1/search',
              collection: 'sentinel-1-rtc',
              tokenUrl: 'https://planetarycomputer.microsoft.com/api/sas/v1/token/sentinel-1-rtc',
            },
            sentinelSearch(sentinel1Values),
            SENTINEL_1_BANDS,
            SENTINEL_1_FIRST_YEAR,
            sentinel1Credit,
            Z_BASE_SATELLITE,
            this.renderer);
    const elevations =
        new RasterTileLayer(
            [MAPTERHORN_COPYRIGHT],
            TERRARIUM_TILE_URL,
            /* tint= */ 0xFFFFFFFF as RgbaU32,
            /* z= */ Z_BASE_ELEVATION,
            /* extraZoom= */ 0,
            /* minZoom= */ 0,
            /* maxZoom= */ TERRARIUM_BASE_ZOOM,
            this.renderer,
            'elevation');

    this.nodes = sortLayerNodes([{
      kind: 'group',
      id: 'osm',
      name: 'OpenStreetMap',
      enabled: true,
      children: [{
        kind: 'layer',
        id: 'osm/ways',
        name: 'Ways',
        // On by default because NATURE_WITHOUT_DETAILED_WAYS hands it the ways.
        enabled: true,
        schema: OSM_WAYS_SCHEMA,
        layer: ways,
        controls: WAY_KINDS.map(({key, label}) => ({kind: 'checkbox', key, label})),
        values: Object.fromEntries(WAY_KINDS.map(({key}) => [key, true])),
        configure: values => {
          ways.setStyle(
              osmWaysOf(WAY_KINDS.filter(({key}) => values[key]).map(({category}) => category)));
        },
      }, {
        kind: 'layer',
        id: 'osm/nodes',
        name: 'Nodes',
        enabled: true,
        schema: OSM_NODES_SCHEMA,
        layer: osmNodes,
        controls: NODE_KINDS.map(({key, label}) => ({kind: 'checkbox', key, label})),
        values: Object.fromEntries(NODE_KINDS.map(({key}) => [key, true])),
        configure: values => {
          osmNodes.setCategories(
              NODE_KINDS.filter(({key}) => values[key]).map(({category}) => category));
        },
      }, {
        kind: 'layer',
        id: 'osm/protomaps',
        name: 'Basemap',
        enabled: true,
        layer: protomaps,
        controls: [
          {kind: 'checkbox', key: 'boundaries', label: 'Boundaries'},
          ...BASEMAP_LABEL_KINDS.map(({key, label}) => ({kind: 'checkbox' as const, key, label})),
        ],
        values: {
          boundaries: true,
          ...Object.fromEntries(BASEMAP_LABEL_KINDS.map(({key}) => [key, true])),
        },
        configure: values => {
          protomaps.setStyle(
              basemapOf(
                  values.boundaries === true,
                  new Set(
                      BASEMAP_LABEL_KINDS
                          .filter(({key}) => values[key])
                          .flatMap(({layerNames}) => layerNames))));
        },
      }],
    }, {
      kind: 'group',
      id: 'national',
      name: 'National',
      enabled: true,
      // Children keep their top level ids because saved view states refer to layers by id.
      children: [{
        kind: 'group',
        id: 'us',
        name: 'United States',
        enabled: true,
        children: [{
          kind: 'group',
          id: 'us/conditions',
          name: 'Conditions',
          enabled: true,
          children: [
            this.newCollectionEntry(
                'us/conditions/fire_perimeters',
                'Fire perimeters',
                FIRE_PERIMETERS_COLLECTION_ID,
                {
                  long:
                      'Current interagency fire perimeters from the National Interagency Fire '
                          + 'Center',
                  short: 'NIFC',
                  url: 'https://data-nifc.opendata.arcgis.com/',
                  publicDomain: true,
                },
                // Few enough to load the whole country at once: 113 perimeters were 413 kB on
                // 2026-10-03.
                {minZoom: 0, maxZoom: undefined, indexBottom: 4, fromLevel: 0, toLevel: undefined},
                locations),
            this.newCollectionEntry(
                'us/conditions/air_quality',
                'Air quality',
                AIR_QUALITY_COLLECTION_ID,
                {
                  // AirNow's guidelines ask for the agencies to be credited first.
                  // https://docs.airnowapi.org/docs/DataUseGuidelines.pdf
                  long:
                      'Current air quality index contours from state, local, and tribal air '
                          + 'quality agencies and the US EPA AirNow program, preliminary and '
                          + 'unverified',
                  short: 'AirNow',
                  url: 'https://www.airnow.gov/',
                  publicDomain: true,
                },
                // Few enough to load the whole country at once: 79 contours were 180 kB of GeoJSON
                // on 2026-10-03.
                {minZoom: 0, maxZoom: undefined, indexBottom: 4, fromLevel: 0, toLevel: undefined},
                locations),
            this.newArcGisExportEntry(
                'us/conditions/radar',
                'NOAA radar',
                {
                  long: 'Multi-Radar Multi-Sensor base reflectivity from NOAA',
                  short: 'NOAA MRMS',
                  url: 'https://radar.weather.gov/',
                  publicDomain: true,
                },
                'eventdriven/rest/services/radar/radar_base_reflectivity/MapServer',
                /* layers= */ undefined,
                // MRMS has 1 km cells and a zoom 9 pixel is about 300 m, so more zoom adds no
                // detail.
                /* maxZoom= */ 9),
            this.newCollectionEntry(
                'us/conditions/river_gauges',
                'River gauges',
                RIVER_GAUGES_COLLECTION_ID,
                {
                  long: 'River observations from the NOAA National Water Prediction Service',
                  short: 'NOAA NWPS',
                  url: 'https://water.noaa.gov/',
                  publicDomain: true,
                },
                // Conditions.kt puts every gauge in a level 13 cell. There are about 11,500 gauges,
                // too many to draw zoomed out, so they start at zoom 6.
                {minZoom: 6, maxZoom: undefined, indexBottom: 6, fromLevel: 13, toLevel: 13},
                locations),
            this.newSnowEntry(SNOW_DEPTH_ID, 'Snow depth', 'snow_depth'),
            this.newSnowEntry(SNOW_WATER_ID, 'Snow water equivalent', 'snow_water'),
          ],
        }, {
          kind: 'layer',
          id: 'us/public_land',
          name: 'Public land',
          enabled: false,
          layer: new CollectionLayer(
              [{
                long:
                    'Protected Areas Database of the United States (PAD-US) 4.1 from the USGS Gap '
                        + 'Analysis Project',
                short: 'USGS PAD-US',
                url: 'https://doi.org/10.5066/P96WBCHS',
                publicDomain: true,
              }],
              '/api/collections/22b0cb56-dc1f-4546-8615-3382dc3eb44a',
              /* style= */ undefined,
              // Snapping to a level whose cells are a few pixels across is invisible and saves most
              // of the geometry, but past zoom 10 we want the real boundaries.
              [
                {minZoom: 0, snap: 11},
                {minZoom: 7, snap: 14},
                {minZoom: 10, snap: undefined},
              ],
              [
                // Anything wider than a level 10 cell, so about 7 km up. That reaches the national
                // parks, which sit at levels 6 to 9, and it is everything the coarsest snap can
                // draw: snapping to level 11 erases whatever is smaller than a level 11 cell
                // anyway.
                //
                // Tiled at level 5 rather than 4 because a tile carries its objects across its
                // whole cell, so a coarser tiling means pulling parks hundreds of km offscreen once
                // zoomed in. Level 5 costs 205 requests for a view of the western US instead of 68,
                // and 2.9 MB instead of 4.5 MB at zoom 11.
                {minZoom: 0, maxZoom: undefined, indexBottom: 5, fromLevel: 0, toLevel: 10},
                // Everything smaller. A level 6 cell holds up to 11k of these, which is why they
                // wait until the viewport is small enough to be worth it.
                {minZoom: 7, maxZoom: undefined, indexBottom: 6, fromLevel: 11, toLevel: undefined},
              ],
              locations,
              this.camera,
              this.renderer,
          ),
          controls: [],
          values: {},
        }, {
          kind: 'layer',
          id: 'us/topo',
          name: 'US Topo',
          enabled: false,
          layer: new RasterTileLayer(
              [{
                long:
                    'Map services and data available from U.S. Geological Survey, National '
                        + 'Geospatial Program',
                short: 'USGS',
                url: 'https://www.usgs.gov/programs/national-geospatial-program/national-map',
                publicDomain: true,
              }],
              'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile'
                  + '/${id.zoom}/${id.y}/${id.x}',
              /* tint= */ 0xFFFFFFFF as RgbaU32,
              /* z= */ Z_BASE_SATELLITE,
              /* extraZoom= */ 0,
              /* minZoom= */ 0,
              // USGS caches tiles through zoom 15 and 404s past it.
              /* maxZoom= */ 15,
              this.renderer,
          ),
          controls: [],
          values: {},
        },
          this.newSectionalEntry(),
        ],
      }, {
        kind: 'group',
        id: 'europe',
        name: 'Europe',
        enabled: true,
        children: [
          this.newCollectionEntry(
              'europe/air_quality',
              'Air quality',
              EUROPEAN_AIR_QUALITY_COLLECTION_ID,
              {
                long: 'European Air Quality Index from the European Environment Agency, unverified',
                short: 'EEA',
                url: 'https://airindex.eea.europa.eu/AQI/index.html',
                license: CC_BY_4,
              },
              // Conditions.kt puts every station in a level 13 cell. There are about 3,500, few
              // enough to draw all of Europe from zoom 4.
              {minZoom: 4, maxZoom: undefined, indexBottom: 4, fromLevel: 13, toLevel: 13},
              locations),
          this.newCollectionEntry(
              'europe/burnt_areas',
              'Burnt areas',
              BURNT_AREAS_COLLECTION_ID,
              {
                long:
                    'Burnt areas from the last 30 days from the European Forest Fire Information '
                        + 'System. Contains modified Copernicus Emergency Management Service '
                        + `information ${new Date().getUTCFullYear()}`,
                short: 'EFFIS',
                url: 'https://forest-fire.emergency.copernicus.eu/',
                license: CC_BY_4,
              },
              // Few enough to load all of Europe at once: 1,318 areas were 7.4 MB of GeoJSON on
              // 2026-10-13.
              {minZoom: 0, maxZoom: undefined, indexBottom: 4, fromLevel: 0, toLevel: undefined},
              locations),
          {
            kind: 'layer',
            id: 'europe/protected_areas',
            name: 'Protected areas',
            enabled: false,
            layer: new CollectionLayer(
                [{
                  long: 'Nationally designated areas 2026 from the European Environment Agency',
                  short: 'EEA',
                  url: 'https://doi.org/10.2909/028003e7-7585-4d69-92fc-7f81e0cc2340',
                  license: CC_BY_4,
                }],
                '/api/collections/26f6d026-6b2b-47bc-b2d6-1454061b996d',
                /* style= */ undefined,
                // Same snapping and tiling as the public land layer, see there for why
                [
                  {minZoom: 0, snap: 11},
                  {minZoom: 7, snap: 14},
                  {minZoom: 10, snap: undefined},
                ],
                [
                  {minZoom: 0, maxZoom: undefined, indexBottom: 5, fromLevel: 0, toLevel: 10},
                  {
                    minZoom: 7,
                    maxZoom: undefined,
                    indexBottom: 6,
                    fromLevel: 11,
                    toLevel: undefined,
                  },
                ],
                locations,
                this.camera,
                this.renderer,
            ),
            controls: [],
            values: {},
          },
        ],
      }, {
        kind: 'group',
        id: 'ch',
        name: 'Switzerland',
        enabled: true,
        children: [
          this.newSwisstopoEntry(
              'ch/topo', 'Swiss Topo', [SWISSTOPO_COPYRIGHT], 'ch.swisstopo.pixelkarte-farbe',
              'jpeg', Z_BASE_SATELLITE, /* maxZoom= */ 19),
        ],
      }, {
        kind: 'group',
        id: 'fr',
        name: 'France',
        enabled: true,
        children: [
          this.newIgnEntry(
              'fr/plan_ign', 'Plan IGN', 'Plan IGN v2', 'GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2',
              'image/png'),
          this.newIgnEntry(
              'fr/orthophotos', 'Orthophotos', 'BD ORTHO orthophotos', 'ORTHOIMAGERY.ORTHOPHOTOS',
              'image/jpeg'),
        ],
      }, {
        kind: 'group',
        id: 'jp',
        name: 'Japan',
        enabled: true,
        children: [{
          kind: 'layer',
          id: 'jp/national_parks',
          name: 'National parks',
          enabled: false,
          layer: new CollectionLayer(
              [{
                // PDL 1.0 requires saying the data was processed and by whom.
                long:
                    'National park zones from the Biodiversity Center of Japan, Ministry of the '
                        + 'Environment, processed by trails.lat',
                short: 'MOE',
                url: 'https://www.biodic.go.jp/nps_nwp_nca_cz.html',
              }],
              '/api/collections/4e9dde6b-0ccb-4287-adf6-c179f7a08c95',
              /* style= */ undefined,
              // Same snapping and tiling as the public land layer, see there for why
              [
                {minZoom: 0, snap: 11},
                {minZoom: 7, snap: 14},
                {minZoom: 10, snap: undefined},
              ],
              [
                {minZoom: 0, maxZoom: undefined, indexBottom: 5, fromLevel: 0, toLevel: 10},
                {
                  minZoom: 7,
                  maxZoom: undefined,
                  indexBottom: 6,
                  fromLevel: 11,
                  toLevel: undefined,
                },
              ],
              locations,
              this.camera,
              this.renderer,
          ),
          controls: [],
          values: {},
        }],
      }],
    }, {
      kind: 'group',
      id: 'aviation',
      name: 'Aviation',
      enabled: true,
      children: [
        {
          kind: 'layer',
          id: 'aviation/airspace',
          name: 'Airspace',
          enabled: false,
          layer: new CollectionLayer(
              [OPENAIP_COPYRIGHT],
              `/api/collections/${AIRSPACE_COLLECTION_ID}`,
              /* style= */ undefined,
              // Same snapping and tiling as the public land layer, see there for why. There are
              // about 34,000 airspaces worldwide, packed densest over Europe.
              [
                {minZoom: 0, snap: 11},
                {minZoom: 7, snap: 14},
                {minZoom: 10, snap: undefined},
              ],
              [
                {minZoom: 0, maxZoom: undefined, indexBottom: 5, fromLevel: 0, toLevel: 10},
                {
                  minZoom: 7,
                  maxZoom: undefined,
                  indexBottom: 6,
                  fromLevel: 11,
                  toLevel: undefined,
                },
              ],
              locations,
              this.camera,
              this.renderer,
          ),
          controls: [],
          values: {},
        },
        this.newCollectionEntry(
            'aviation/airports',
            'Airports',
            AIRPORTS_COLLECTION_ID,
            OPENAIP_COPYRIGHT,
            // AviationVectors.kt puts every point in a level 13 cell. There are about 47,000
            // airports and almost half of them are in the US, so they wait until zoom 7.
            {minZoom: 7, maxZoom: undefined, indexBottom: 6, fromLevel: 13, toLevel: 13},
            locations),
        this.newCollectionEntry(
            'aviation/navaids',
            'Navaids',
            NAVAIDS_COLLECTION_ID,
            OPENAIP_COPYRIGHT,
            // About 4,900, which is as many as the European air quality stations
            {minZoom: 4, maxZoom: undefined, indexBottom: 4, fromLevel: 13, toLevel: 13},
            locations),
        this.newCollectionEntry(
            'aviation/reporting_points',
            'Reporting points',
            REPORTING_POINTS_COLLECTION_ID,
            OPENAIP_COPYRIGHT,
            // About 6,000, almost all in Europe and clustered around airports
            {minZoom: 6, maxZoom: undefined, indexBottom: 6, fromLevel: 13, toLevel: 13},
            locations),
        {
          ...this.newCollectionEntry(
            'aviation/weather_stations',
            'Weather stations',
            WEATHER_STATIONS_COLLECTION_ID,
            {
              long: 'Weather stations from the NOAA Aviation Weather Center',
              short: 'NOAA AWC',
              url: 'https://aviationweather.gov/',
              publicDomain: true,
            },
            // About 7,700 that report METARs, tiled like the river gauges
            {minZoom: 6, maxZoom: undefined, indexBottom: 6, fromLevel: 13, toLevel: 13},
            locations),
          weatherStation: {id: 'station', reports: 'reports'},
        },
      ],
    }, {
      kind: 'group',
      id: 'satellite',
      name: 'Satellite',
      enabled: true,
      children: [{
        kind: 'group',
        id: 'satellite/goes',
        name: 'GOES',
        enabled: true,
        children: [
          this.newGoesEntry('East', 'GeoColor', 'GeoColor'),
          this.newGoesEntry('East', 'FireTemp', 'fire temperature'),
          this.newGoesEntry('West', 'GeoColor', 'GeoColor'),
          this.newGoesEntry('West', 'FireTemp', 'fire temperature'),
        ],
      }, {
        kind: 'layer',
        id: 'satellite/sentinel_1',
        name: 'Sentinel-1 RTC',
        enabled: false,
        layer: sentinel1,
        controls: [
          {kind: 'date', key: 'from', label: 'From'},
          {kind: 'date', key: 'to', label: 'To'},
        ],
        values: sentinel1Values,
        configure: values => {
          sentinel1.setSearch(sentinelSearch(values), SENTINEL_1_BANDS);
        },
      }, {
        kind: 'layer',
        id: 'satellite/sentinel',
        name: 'Sentinel-2 L2A',
        enabled: false,
        layer: sentinel,
        controls: [
          {
            kind: 'select',
            key: 'bands',
            label: 'Bands',
            options: [
              {value: 'infrared', label: 'Color infrared'},
              {value: 'scl', label: 'Scene classification'},
              {value: 'swir', label: 'Shortwave infrared'},
              {value: 'ndsi', label: 'Snow index (NDSI)'},
              {value: 'true_color', label: 'True color'},
              {value: 'ndvi', label: 'Vegetation index (NDVI)'},
            ],
          },
          {kind: 'checkbox', key: 'fill_clouds', label: 'Fill clouds'},
          {kind: 'date', key: 'from', label: 'From'},
          {kind: 'date', key: 'to', label: 'To'},
          {kind: 'percent', key: 'cloud', label: 'Max cloud cover'},
        ],
        values: sentinelValues,
        configure: values => {
          sentinel.setSearch(sentinelSearch(values), sentinel2Bands(values));
        },
      }],
    }, {
      kind: 'group',
      id: 'weather',
      name: 'Weather',
      enabled: true,
      children: [
        this.newWindEntry(),
        this.newWeatherEntry('gust', 'Wind gusts'),
        this.newWeatherEntry('pressure', 'Pressure'),
        this.newWeatherEntry('temperature', 'Temperature'),
        this.newWeatherEntry('dew_point', 'Dew point'),
        this.newWeatherEntry('humidity', 'Humidity'),
        this.newWeatherEntry('wet_bulb', 'Wet-bulb temperature'),
        this.newWeatherEntry('precipitation', 'Rain and thunder'),
        this.newWeatherEntry('snow_depth', 'Snow depth'),
        this.newWeatherEntry('thermals', 'Thermals'),
        this.newWeatherEntry('freezing', 'Freezing altitude'),
        this.newWeatherEntry('waves', 'Waves'),
        this.newLookaheadGroup('wind_accumulation', 'Wind accumulation', 'Strongest gust'),
        this.newLookaheadGroup('rain', 'Rain accumulation', 'Rain'),
        this.newLookaheadGroup('snowfall', 'Snow accumulation', 'Snow'),
        {
          kind: 'group',
          id: 'weather/cloud_cover',
          name: 'Clouds',
          enabled: true,
          children: [
            this.newWeatherEntry('clouds', 'Total', 'Clouds'),
            this.newWeatherEntry('low_clouds', 'Low', 'Low clouds'),
            this.newWeatherEntry('medium_clouds', 'Medium', 'Medium clouds'),
            this.newWeatherEntry('high_clouds', 'High', 'High clouds'),
          ],
        },
        // Pressure levels are labeled by their usual altitude in the standard atmosphere.
        {
          kind: 'group',
          id: 'weather/icing',
          name: 'Icing',
          enabled: true,
          children: [
            this.newWeatherEntry('icing_850', 'FL050, 850 hPa', 'Icing at FL050'),
            this.newWeatherEntry('icing_700', 'FL100, 700 hPa', 'Icing at FL100'),
            this.newWeatherEntry('icing_600', 'FL140, 600 hPa', 'Icing at FL140'),
            this.newWeatherEntry('icing_500', 'FL180, 500 hPa', 'Icing at FL180'),
            this.newWeatherEntry('icing_400', 'FL240, 400 hPa', 'Icing at FL240'),
            this.newWeatherEntry('icing_300', 'FL300, 300 hPa', 'Icing at FL300'),
          ],
        },
        {
          kind: 'group',
          id: 'weather/turbulence',
          name: 'Clear air turbulence',
          enabled: true,
          children: [
            this.newWeatherEntry(
                'turbulence_400_300', 'FL240 to FL300', 'Turbulence, FL240 to FL300'),
            this.newWeatherEntry(
                'turbulence_300_250', 'FL300 to FL340', 'Turbulence, FL300 to FL340'),
            this.newWeatherEntry(
                'turbulence_250_200', 'FL340 to FL390', 'Turbulence, FL340 to FL390'),
            this.newWeatherEntry(
                'turbulence_200_150', 'FL390 to FL450', 'Turbulence, FL390 to FL450'),
          ],
        },
      ],
    }, {
      kind: 'group',
      id: 'topography',
      name: 'Topography',
      enabled: true,
      children: [{
        kind: 'layer',
        id: 'topography/contours',
        name: 'Contours',
        enabled: true,
        layer: this.contours[getUnitSystem()],
        controls: [],
        values: {},
      }, {
        kind: 'layer',
        id: 'topography/hillshades',
        name: 'Hillshades',
        enabled: true,
        layer: new RasterTileLayer(
            [COPERNICUS_DEM_COPYRIGHT, NASADEM_COPYRIGHT],
            'https://tiles.trailcatalog.org/hillshades/${id.zoom}/${id.x}/${id.y}.webp',
            /* tint= */ 0xFFFFFF30 as RgbaU32,
            /* z= */ Z_BASE_TERRAIN,
            /* extraZoom= */ 0,
            /* minZoom= */ 0,
            /* maxZoom= */ 12,
            this.renderer,
        ),
        controls: [],
        values: {},
      }, {
        kind: 'layer',
        id: 'topography/elevations',
        name: 'Elevation colors',
        enabled: false,
        layer: elevations,
        controls: [],
        values: {},
        readout: {
          name: 'Elevation',
          read: point => {
            const packed = elevations.packedAt(point);
            return packed !== undefined ? readElevation(packed) : undefined;
          },
        },
      }, {
        kind: 'layer',
        id: 'topography/slopes',
        name: 'Slope angles',
        enabled: false,
        layer: new SlopeLayer([MAPTERHORN_COPYRIGHT], Z_BASE_SLOPE, this.renderer),
        controls: [],
        values: {},
      }],
    }]);
    const owned =
        new Set([
          ...layerEntries(this.nodes).map(({entry}) => entry.layer),
          ...Object.values(this.contours),
        ]);
    for (const layer of owned) {
      this.registerDisposable(layer);
    }
  }

  // Points the conditions layers at the newest tiles, and keeps checking for newer ones.
  start(): void {
    this.showLatestSectional();
    this.showLatestSnow();
    this.showLatestWeather();
    this.conditionsRefresh.start();
  }

  private newContourLayer(style: Readonly<Style>): MbtileLayer {
    return new MbtileLayer(
        [COPERNICUS_DEM_COPYRIGHT, NASADEM_COPYRIGHT],
        'https://tiles.trailcatalog.org/contours/${id.zoom}/${id.x}/${id.y}.pbf',
        style,
        /* extraZoom= */ 0,
        /* minZoom= */ 9,
        /* maxZoom= */ 14,
        this.renderer);
  }

  private newGoesEntry(satellite: 'East'|'West', product: string, label: string): LayerEntry {
    return {
      kind: 'layer',
      id: `satellite/goes/${satellite}_${product}`,
      name: `${satellite} ${label}`,
      enabled: false,
      layer: new RasterTileLayer(
          [
            {
              long:
                  `GOES-${satellite} ABI imagery from NOAA, tiled by NASA Global Imagery Browse `
                      + 'Services',
              short: 'NOAA/NASA GIBS',
              url: 'https://nasa-gibs.github.io/gibs-api-docs/',
              publicDomain: true,
            },
          ],
          // The path is style/time/matrix set, and "default" for time means the most recent scan
          // GIBS has finished tiling, which runs about 20 minutes behind the satellite.
          `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/GOES-${satellite}_ABI_${product}`
              + '/default/default/GoogleMapsCompatible_Level7'
              + '/${id.zoom}/${id.y}/${id.x}.png',
          /* tint= */ 0xFFFFFFFF as RgbaU32,
          /* z= */ Z_OVERLAY_TERRAIN,
          /* extraZoom= */ 0,
          /* minZoom= */ 0,
          // GoogleMapsCompatible_Level7 stops at zoom 7, which is about the 2 km resolution ABI
          // gives away from the sub-satellite point anyway.
          /* maxZoom= */ 7,
          this.renderer,
      ),
      controls: [],
      values: {},
    };
  }

  // https://www.geo.admin.ch/en/wmts-available-services-and-data
  private newSwisstopoEntry(
      id: string,
      name: string,
      copyrights: Copyright[],
      layer: string,
      extension: string,
      z: number,
      maxZoom: number): LayerEntry {
    return {
      kind: 'layer',
      id,
      name,
      enabled: false,
      layer: new RasterTileLayer(
          copyrights,
          `https://wmts.geo.admin.ch/1.0.0/${layer}/default/current/3857`
              + `/\${id.zoom}/\${id.x}/\${id.y}.${extension}`,
          /* tint= */ 0xFFFFFFFF as RgbaU32,
          z,
          /* extraZoom= */ 0,
          /* minZoom= */ 0,
          maxZoom,
          this.renderer,
      ),
      controls: [],
      values: {},
    };
  }

  // The public Géoplateforme WMTS is the only IGN service without a per-IP quota, and it only
  // takes KVP requests.
  // https://cartes.gouv.fr/aide/fr/guides-utilisateur/utiliser-les-services-de-la-geoplateforme/limites-d-usage/
  private newIgnEntry(
      id: string,
      name: string,
      product: string,
      layer: string,
      format: string): LayerEntry {
    const params = new URLSearchParams({
      SERVICE: 'WMTS',
      REQUEST: 'GetTile',
      VERSION: '1.0.0',
      LAYER: layer,
      STYLE: 'normal',
      FORMAT: format,
      TILEMATRIXSET: 'PM',
    });
    return {
      kind: 'layer',
      id,
      name,
      enabled: false,
      layer: new RasterTileLayer(
          // The Licence Ouverte asks for the date of the last update, and the Géoplateforme
          // serves the current edition.
          [{
            long:
                `${product} from the Institut national de l'information géographique et `
                    + `forestière, current edition as of ${new Date().getUTCFullYear()}`,
            short: 'IGN',
            url: 'https://cartes.gouv.fr/',
            license: {
              name: 'Licence Ouverte 2.0',
              url: 'https://www.etalab.gouv.fr/licence-ouverte-open-licence/',
            },
          }],
          `https://data.geopf.fr/wmts?${params}`
              + '&TILEMATRIX=${id.zoom}&TILEROW=${id.y}&TILECOL=${id.x}',
          /* tint= */ 0xFFFFFFFF as RgbaU32,
          /* z= */ Z_BASE_SATELLITE,
          /* extraZoom= */ 0,
          /* minZoom= */ 0,
          // PM_0_19 in the capabilities
          /* maxZoom= */ 19,
          this.renderer,
      ),
      controls: [],
      values: {},
    };
  }

  private newCollectionEntry(
      id: string,
      name: string,
      collection: string,
      copyright: Copyright,
      stream: Stream,
      locations: LocationIndex): LayerEntry {
    return {
      kind: 'layer',
      id,
      name,
      enabled: false,
      layer: new CollectionLayer(
          [copyright],
          `/api/collections/${collection}`,
          /* style= */ undefined,
          // Same snapping as the public land layer, see there for why
          [
            {minZoom: 0, snap: 11},
            {minZoom: 7, snap: 14},
            {minZoom: 10, snap: undefined},
          ],
          [stream],
          locations,
          this.camera,
          this.renderer,
      ),
      controls: [],
      values: {},
    };
  }

  private newSectionalEntry(): LayerEntry {
    let url = faaSectionalUrl(this.faaCycle);
    const layer =
        new RasterTileLayer(
            [FAA_COPYRIGHT],
            url,
            /* tint= */ 0xFFFFFFFF as RgbaU32,
            /* z= */ Z_BASE_SATELLITE,
            /* extraZoom= */ 0,
            /* minZoom= */ 0,
            // See faa_sectional.py#MAX_ZOOM
            /* maxZoom= */ 12,
            this.renderer);
    return {
      kind: 'layer',
      id: FAA_SECTIONAL_ID,
      name: 'FAA Sectional',
      enabled: false,
      layer,
      controls: [],
      values: {},
      configure: () => {
        // setUrl drops every loaded tile, so we only call it when the URL changes.
        const next = faaSectionalUrl(this.faaCycle);
        if (next !== url) {
          url = next;
          layer.setUrl(next);
        }
      },
    };
  }

  private newSnowEntry(id: string, name: string, decode: Decode): LayerEntry {
    let url = snodasUrl(this.snodasDay);
    const layer =
        new RasterTileLayer(
            [SNODAS_COPYRIGHT],
            url,
            /* tint= */ 0xFFFFFFFF as RgbaU32,
            /* z= */ Z_OVERLAY_TERRAIN,
            /* extraZoom= */ 0,
            /* minZoom= */ 0,
            // See Snodas.kt#MAX_ZOOM
            /* maxZoom= */ 7,
            this.renderer,
            decode);
    return {
      kind: 'layer',
      id,
      name,
      enabled: false,
      layer,
      controls: [],
      values: {},
      readout: {
        name: `${name} (SNODAS)`,
        read: point => {
          const packed = layer.packedAt(point);
          return packed !== undefined ? readSnodas(decode === 'snow_depth', packed) : undefined;
        },
      },
      configure: () => {
        // setUrl drops every loaded tile, so we only call it when the URL changes.
        const next = snodasUrl(this.snodasDay);
        if (next !== url) {
          url = next;
          layer.setUrl(next);
        }
      },
    };
  }

  // Points the sectional layer at the cycle in effect, or the one before it while ours is late.
  // Every archive has the 0/0/0 tile, see faa_sectional.py#write_tiles.
  private showLatestSectional(): void {
    const tryCycle = (offset: number) => {
      if (offset < -1) {
        return;
      }
      const cycle = faaCycle(offset);
      fetch(`${FAA_SECTIONAL_URL}${cycle}/0/0/0.webp`).then(response => {
        if (!response.ok) {
          tryCycle(offset - 1);
          return;
        }
        this.faaCycle = cycle;
        this.configureEntries(id => id === FAA_SECTIONAL_ID);
      }, () => {});
    };
    tryCycle(0);
  }

  // Points the snow layers at the newest tiled day. We check for the 0/0/0 tile because every
  // archive has it, see Snodas.kt.
  private showLatestSnow(): void {
    const tryDay = (offset: number) => {
      if (offset < -SNODAS_LOOKBACK_DAYS) {
        return;
      }
      const day = utcDay(offset);
      fetch(`${SNODAS_URL}${day}/0/0/0.png`).then(response => {
        if (!response.ok) {
          tryDay(offset - 1);
          return;
        }
        this.snodasDay = day;
        this.configureEntries(id => id === SNOW_DEPTH_ID || id === SNOW_WATER_ID);
      }, () => {});
    };
    tryDay(0);
  }

  private configureEntries(matches: (id: string) => boolean): void {
    for (const {entry} of layerEntries(this.current())) {
      if (matches(entry.id)) {
        entry.configure?.(entry.values);
      }
    }
  }

  // readoutName labels a click's reading, for an entry whose name only makes sense in its group.
  private newWeatherEntry(view: WeatherView, name: string, readoutName = name): LayerEntry {
    const archive = WEATHER_VIEWS[view].layer;
    let url = ecmwfUrl(this.ecmwfRun, archive);
    const layer =
        new RasterTileLayer(
            [ECMWF_COPYRIGHT],
            url,
            /* tint= */ 0xFFFFFFFF as RgbaU32,
            /* z= */ Z_OVERLAY_TERRAIN,
            /* extraZoom= */ 0,
            /* minZoom= */ 0,
            // See Weather.kt#MAX_ZOOM
            /* maxZoom= */ 3,
            this.renderer,
            `weather/${view}`);
    return {
      kind: 'layer',
      id: `weather/${view}`,
      name,
      enabled: false,
      layer,
      controls: [],
      values: {},
      readout: {
        name: readoutName,
        read: point => {
          const packed = layer.packedAt(point);
          return packed !== undefined ? readWeather(view, packed) : undefined;
        },
      },
      configure: () => {
        // setUrl drops every loaded tile, so we only call it when the URL changes.
        const next = ecmwfUrl(this.ecmwfRun, archive);
        if (next !== url) {
          url = next;
          layer.setUrl(next);
        }
      },
    };
  }

  // Wind speed colors, with streamlines or barbs over them
  private newWindEntry(): LayerEntry {
    const speed = this.newWeatherEntry('wind', 'Wind');
    let url = ecmwfUrl(this.ecmwfRun, 'wind');
    const vectors =
        new WindVectorLayer(
            [ECMWF_COPYRIGHT],
            url,
            /* z= */ Z_OVERLAY_TERRAIN + 0.5,
            // See Weather.kt#MAX_ZOOM
            /* maxZoom= */ 3,
            this.renderer);
    vectors.setStyle('streamlines');
    return {
      ...speed,
      layer: new CompositeLayer([speed.layer, vectors]),
      controls: [{
        kind: 'select',
        key: 'arrows',
        label: 'Arrows',
        options: [
          {value: 'none', label: 'None'},
          {value: 'streamlines', label: 'Streamlines'},
          {value: 'barbs', label: 'Barbs'},
        ],
      }],
      values: {arrows: 'streamlines'},
      configure: values => {
        speed.configure?.(values);
        const arrows = values.arrows;
        vectors.setStyle(arrows === 'streamlines' || arrows === 'barbs' ? arrows : undefined);
        // setUrl drops every loaded tile, so we only call it when the URL changes.
        const next = ecmwfUrl(this.ecmwfRun, 'wind');
        if (next !== url) {
          url = next;
          vectors.setUrl(next);
        }
      },
    };
  }

  // Groups the views that total the next 12 hours through the next 5 days, see
  // WeatherLayers.kt#LOOKAHEAD_LAYERS.
  private newLookaheadGroup(prefix: string, name: string, what: string): LayerGroup {
    const windows = [[12, '12 hours'], [24, '24 hours'], [72, '3 days'], [120, '5 days']] as const;
    return {
      kind: 'group',
      id: `weather/${prefix}`,
      name,
      enabled: true,
      children: windows.map(([hours, label]) =>
          this.newWeatherEntry(`${prefix}_${hours}` as WeatherView, `${what}, next ${label}`)),
    };
  }

  // Points the weather layers at the newest tiled run. ecmwf.sh writes wind at step 0 last, so we
  // take its 0/0/0 tile to mean the whole run is there.
  private showLatestWeather(): void {
    const cycleMs = ECMWF_CYCLE_HOURS * HOUR_MS;
    const newest = Math.floor(Date.now() / cycleMs) * cycleMs;
    const tryRun = (run: number) => {
      if (run < newest - ECMWF_LOOKBACK_CYCLES * cycleMs) {
        return;
      }
      const tile = ecmwfStepUrl(run, 'wind', 0).replace('${id.zoom}/${id.x}/${id.y}', '0/0/0');
      fetch(tile).then(response => {
        if (!response.ok) {
          tryRun(run - cycleMs);
          return;
        }
        this.ecmwfRun = run;
        this.configureEntries(id => id.startsWith('weather/'));
      }, () => {});
    };
    tryRun(newest);
  }

  private newArcGisExportEntry(
      id: string,
      name: string,
      copyright: Copyright,
      service: string,
      layers: string|undefined,
      maxZoom: number): LayerEntry {
    const params = new URLSearchParams({
      bboxSR: '3857',
      imageSR: '3857',
      size: '256,256',
      format: 'png32',
      transparent: 'true',
      f: 'image',
    });
    if (layers) {
      params.set('layers', layers);
    }
    return {
      kind: 'layer',
      id,
      name,
      enabled: false,
      layer: new RasterTileLayer(
          [copyright],
          `https://mapservices.weather.noaa.gov/${service}/export?bbox=\${bbox}&${params}`,
          /* tint= */ 0xFFFFFFFF as RgbaU32,
          /* z= */ Z_OVERLAY_TERRAIN,
          /* extraZoom= */ 0,
          /* minZoom= */ 0,
          maxZoom,
          this.renderer,
      ),
      controls: [],
      values: {},
    };
  }
}

// The first day of the FAA cycle in effect, offset by whole cycles
function faaCycle(offset: number): string {
  const cycleMs = FAA_CYCLE_DAYS * 24 * HOUR_MS;
  const index = Math.floor((Date.now() - FAA_CYCLE_EPOCH_MS) / cycleMs) + offset;
  return new Date(FAA_CYCLE_EPOCH_MS + index * cycleMs).toISOString().substring(0, 10);
}

function faaSectionalUrl(cycle: string): string {
  return `${FAA_SECTIONAL_URL}${cycle}/\${id.zoom}/\${id.x}/\${id.y}.webp`;
}

// Today plus offset days, as a UTC date because SNODAS days are UTC
function utcDay(offset: number): string {
  return new Date(Date.now() + offset * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);
}

// The step closest to now, or the last one the archive has
function ecmwfUrl(run: number, archive: EcmwfLayer): string {
  const {lookaheadHours, stepHours}: {lookaheadHours?: number; stepHours: number} =
      ECMWF_LAYERS[archive];
  const last = ECMWF_MAX_STEP - (lookaheadHours ?? 0);
  const fromRun = (Date.now() - run) / HOUR_MS;
  const step =
      Math.min(Math.max(Math.round(fromRun / stepHours) * stepHours, 0), last - last % stepHours);
  return ecmwfStepUrl(run, archive, step);
}

function ecmwfStepUrl(run: number, archive: EcmwfLayer, step: number): string {
  // Runs are named like 2026101518
  const iso = new Date(run).toISOString();
  const name = iso.substring(0, 10).replaceAll('-', '') + iso.substring(11, 13);
  return `${ECMWF_URL}${name}_${archive}_${step}/\${id.zoom}/\${id.x}/\${id.y}.webp`;
}

function snodasUrl(day: string): string {
  return `${SNODAS_URL}${day}/\${id.zoom}/\${id.x}/\${id.y}.png`;
}

// The local day, because that is what a date input shows and edits
function isoDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

// An empty day leaves that end open, which STAC writes as ..
function sentinelSearch(values: ControlValues): Search {
  const from = String(values.from);
  const to = String(values.to);
  return {
    // Without a zone, Date reads these as local time.
    from: from ? new Date(`${from}T00:00:00`).toISOString() : '..',
    to: to ? new Date(`${to}T23:59:59.999`).toISOString() : '..',
    // Sentinel-1 skips cloud filtering because its radar sees through clouds.
    query: values.cloud === undefined ? {} : {'eo:cloud_cover': {lte: values.cloud}},
  };
}

// Defaults to masked true color because older saved views have no bands or fill_clouds value.
function sentinel2Bands(values: ControlValues): Bands {
  const bands = SENTINEL_2_BANDS[String(values.bands)] ?? SENTINEL_2_BANDS.true_color;
  return values.fill_clouds === false ? bands : {...bands, mask: SENTINEL_2_MASK};
}

function byteSample(asset: string, sample: number): Channel {
  return {asset, sample, nearest: false, offset: 0, decibels: false, scale: 1, bias: 0};
}

// Stretches reflectance from 0 to 0.4 across a byte, the gain of 2.5 Sentinel Hub's composites use.
// Sentinel-2 Collection 1 stores reflectance as 0.0001 * (DN - 1000) in every year.
function reflectance(asset: string): Channel {
  return {
    asset,
    sample: 0,
    nearest: false,
    offset: -1000,
    decibels: false,
    scale: 0.0001 * 255 / 0.4,
    bias: 0,
  };
}

// An index like NDVI from two Sentinel-2 bands, written as its indexByte
function normalizedDifference(a: string, b: string): Channel {
  return {
    asset: a,
    sample: 0,
    nearest: false,
    // the 0.0001 scale cancels out of the ratio, but the offset doesn't
    offset: -1000,
    combine: {asset: b, sample: 0, op: 'normalized_difference'},
    decibels: false,
    scale: 127.5,
    bias: 127.5,
  };
}

// Maps -1 to 1 across a byte, the way normalizedDifference writes it
function indexByte(index: number): number {
  return Math.round(127.5 * (index + 1));
}

function decibels(asset: string, over: string|undefined, low: number, high: number): Channel {
  return {
    asset,
    sample: 0,
    nearest: false,
    offset: 0,
    combine: over === undefined ? undefined : {asset: over, sample: 0, op: 'ratio'},
    decibels: true,
    scale: 255 / (high - low),
    bias: -255 * low / (high - low),
  };
}

// https://sentinels.copernicus.eu/documents/247904/690755/Sentinel_Data_Legal_Notice
function copernicusCredit(years: string): Copyright[] {
  return [{
    long: `Contains modified Copernicus Sentinel data ${years}`,
    short: `Copernicus Sentinel ${years}`,
  }];
}

// Credits Copernicus and Catalyst separately because Catalyst licenses its terrain correction
// apart from the Copernicus data.
function sentinel1Credit(years: string): Copyright[] {
  return [
    ...copernicusCredit(years),
    {
      long: 'Sentinel-1 RTC by Catalyst',
      short: 'Catalyst',
      url: 'https://planetarycomputer.microsoft.com/dataset/sentinel-1-rtc',
      provider: {
        name: 'Microsoft Planetary Computer',
        url: 'https://planetarycomputer.microsoft.com',
      },
      license: CC_BY_4,
    },
  ];
}
