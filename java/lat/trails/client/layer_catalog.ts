import { checkExists } from 'external/dev_april_corgi+/js/common/asserts';
import { Disposable } from 'external/dev_april_corgi+/js/common/disposable';
import { Timer } from 'external/dev_april_corgi+/js/common/timer';

import { Camera } from 'js/map/camera';
import { COPERNICUS_DEM_COPYRIGHT, MAPTERHORN_COPYRIGHT, NASADEM_COPYRIGHT, OSM_COPYRIGHT, PROTOMAPS_COPYRIGHT } from 'js/map/common/copyrights';
import { Copyright, RgbaU32 } from 'js/map/common/types';
import { CompositeLayer } from 'js/map/layers/composite_layer';
import { CONTOURS_FEET, CONTOURS_METERS, MbtileLayer } from 'js/map/layers/mbtile_layer';
import { RasterTileLayer } from 'js/map/layers/raster_tile_layer';
import { SlopeLayer } from 'js/map/layers/slope_layer';
import { StepLayer } from 'js/map/layers/step_layer';
import { StacLayer } from 'js/map/layers/stac_layer';
import { SwitchLayer } from 'js/map/layers/switch_layer';
import { WindVectorLayer } from 'js/map/layers/wind_vector_layer';
import { Renderer } from 'js/map/rendering/renderer';
import { Elevations } from 'js/map/workers/elevations';
import { LocationIndex } from 'js/map/workers/location_index';
import { Style } from 'js/map/workers/mbtile_loader';
import { Decode } from 'js/map/workers/raster_loader';
import { Stream } from 'js/map/workers/s2_streams';
import { Bands, Channel, Search } from 'js/map/workers/stac_loader';
import { BASE_ZOOM as TERRARIUM_BASE_ZOOM, TILE_URL as TERRARIUM_TILE_URL } from 'js/map/workers/terrarium';
import { ECMWF_LAYERS, EcmwfLayer, WEATHER_VIEWS, WeatherView, WIND_LEVELS } from 'js/map/workers/weather';
import { WindStyle } from 'js/map/workers/wind_loader';
import { Z_BASE_ELEVATION, Z_BASE_SATELLITE, Z_BASE_SLOPE, Z_BASE_TERRAIN, Z_OVERLAY_TERRAIN } from 'js/map/z';
import { getUnitSystem, UnitSystem } from 'js/units/formatters';

import { CollectionLayer } from './collection_layer';
import {
  ControlValues,
  LayerControl,
  LayerEntry,
  layerEntries,
  LayerNode,
} from './layer_tree';
import { PointCollectionLayer } from './point_collection_layer';
import { readElevation, readSnodas, readWeather } from './readings';
import { SkyLayer, ViewshedMode } from './sky_layer';
import { OSM_NODES_SCHEMA, OSM_WAYS_SCHEMA } from './schema';
import {
  BASEMAP_LABEL_KINDS,
  basemapOf,
  getDrawnCategories,
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
const PREFETCH_STEPS = 2;
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
  long: 'Aeronautical charts from FAA Aeronautical Information Services',
  short: 'FAA',
  url: 'https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/',
  publicDomain: true,
};
// Keep in sync with faa_charts.py, which writes one archive per product and cycle named
// faa_<product>_<cycle>.pmtiles
const FAA_TILES_URL = 'https://tiles.trailcatalog.org/faa_';
// Charts take effect at 0901 UTC on the first day of their cycle. See faa_charts.py#CYCLE_EPOCH.
const FAA_CYCLE_EPOCH_MS = Date.UTC(2026, 8, 3, 9, 1);
const FAA_CYCLE_DAYS = 56;
type FaaProduct = 'sectional'|'terminal'|'enroute_low'|'enroute_high';
const FAA_PRODUCTS: FaaProduct[] = ['sectional', 'terminal', 'enroute_low', 'enroute_high'];
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
// Pressure levels in hPa by their altitude in the standard atmosphere
const FLIGHT_LEVELS: Record<number, string> = {
  925: 'FL025',
  850: 'FL050',
  700: 'FL100',
  600: 'FL140',
  500: 'FL180',
  400: 'FL240',
  300: 'FL300',
  250: 'FL340',
  200: 'FL390',
  150: 'FL450',
};
const CLOUD_HEIGHTS: Array<{view: WeatherView; label: string; name: string}> = [
  {view: 'clouds', label: 'All', name: 'Clouds'},
  {view: 'low_clouds', label: 'Low', name: 'Low clouds'},
  {view: 'medium_clouds', label: 'Medium', name: 'Medium clouds'},
  {view: 'high_clouds', label: 'High', name: 'High clouds'},
];
// See WeatherLayers.kt#LOOKAHEAD_LAYERS and #PEAK_WINDOWS
const LOOKAHEAD_WINDOWS = [[12, '12 hours'], [24, '24 hours'], [72, '3 days'], [120, '5 days']];
// Runs land 6 to 9 hours after they start, and past that a stale run means ecmwf.sh stopped
// tiling. A 3 day old run still forecasts now, so we reach back that far.
const ECMWF_LOOKBACK_CYCLES = 12;
export const SKY_LAYER_ID = 'weather/sun_moon';
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
// Keep in sync with UsfsMvum.kt
const MOTOR_VEHICLE_USE_COLLECTION_ID = '0dc37e1d-bcac-4720-9a23-1cc0683e7090';
// Where trailcatalog starts drawing its points, see trail_layer.ts#RENDER_POINT_ZOOM_THRESHOLD
const POINT_ICON_ZOOM = 14;

/** The map layers we offer besides a collection's own features. */
export class LayerCatalog extends Disposable {

  readonly contours: Record<UnitSystem, MbtileLayer>;
  // What the layer tree starts as
  readonly nodes: LayerNode[];
  // The start of the newest ECMWF run we know is tiled, in ms
  private ecmwfRun: number;
  // The time the weather layers forecast for in ms, or undefined to follow the clock
  private time: number|undefined;
  private readonly sky: SkyLayer;
  // The newest SNODAS day we know is tiled
  private snodasDay: string;
  // The newest FAA cycle in effect that we know is tiled, for each product
  private readonly faaCycles: Record<FaaProduct, string>;
  private readonly conditionsRefresh: Timer;

  constructor(
      locations: LocationIndex,
      private readonly camera: Camera,
      elevationSampler: Elevations,
      private readonly renderer: Renderer,
      // The tree as the viewer holds it, whose values a newer run or day reconfigures with
      private readonly current: () => LayerNode[],
      private readonly runChanged: () => void) {
    super();
    // We start on the current run and day, and showLatestWeather and showLatestSnow fall back to
    // older ones when those aren't tiled yet.
    const cycleMs = ECMWF_CYCLE_HOURS * HOUR_MS;
    this.ecmwfRun = Math.floor(Date.now() / cycleMs) * cycleMs;
    this.time = undefined;
    this.sky = new SkyLayer(camera, elevationSampler, renderer);
    this.snodasDay = utcDay(0);
    this.faaCycles = {
      sectional: faaCycle(0),
      terminal: faaCycle(0),
      enroute_low: faaCycle(0),
      enroute_high: faaCycle(0),
    };
    this.conditionsRefresh = new Timer(CONDITIONS_REFRESH_MS, () => {
      this.showLatestFaaCharts();
      this.showLatestSnow();
      this.showLatestWeather();
    });
    this.registerDisposable(this.conditionsRefresh);

    this.contours = {
      imperial: this.newContourLayer('imperial'),
      metric: this.newContourLayer('metric'),
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
              // Each band fetches the S2 cells of one level, and the level goes up by one every two
              // zooms. Finer cells mean more requests, and coarser cells reach further past the
              // screen. This schedule keeps a viewport near 50 requests that cover about 5x the
              // screen. One level for every zoom does not work: level 11 takes 903 requests at
              // zoom 10 and covers 30x the screen at zoom 15.
              //
              // A cell's ways arrive in one response, which the loader decodes in one task, so a
              // coarse cell in a dense city is one very large download and one long decode. The
              // worst level 9 cell is central Berlin, with 221k paths in 3.7 MB, and a level 8
              // cell covers four times the area. So the schedule starts at level 9 for zoom 10.
              //
              // Bands also start at zooms 11 and 13, because the style draws more from there:
              // paths and residential streets from 11, service roads from 13. Each band asks the
              // server only for the categories it draws, which removes 82% of the ways in a
              // Seattle viewport at zoom 10 and 37% at zoom 12.
              //
              // Splitting into fine-grained bands is cheap. Zooming in already refetches every
              // cell at each integer zoom up to 15, because the snap level changes. Only zooming
              // out across a band boundary refetches cells that could have been reused.
              //
              // These streams carry the short ways, whose smallest containing cell is level 11 or
              // finer. The streams below carry the longer ways, so every way is covered.
              {minZoom: 10, maxZoom: 11, indexBottom: 9, fromLevel: 11, toLevel: undefined},
              {minZoom: 11, maxZoom: 12, indexBottom: 9, fromLevel: 11, toLevel: undefined},
              {minZoom: 12, maxZoom: 13, indexBottom: 10, fromLevel: 11, toLevel: undefined},
              {minZoom: 13, maxZoom: 14, indexBottom: 10, fromLevel: 11, toLevel: undefined},
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
            ].map(stream => ({
              ...stream,
              // From the full style rather than the kinds the Ways layer shows, so that toggling a
              // kind restyles what is held instead of refetching
              categories: getDrawnCategories(OSM_WAYS, stream.minZoom, stream.maxZoom),
            })),
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
            NODE_KINDS.filter(({hidden}) => !hidden).map(({category}) => category),
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

    this.nodes = [{
      kind: 'group',
      id: 'aviation',
      name: 'Aviation',
      enabled: true,
      children: [
        this.newCollectionEntry(
            'aviation/airports',
            'Airports',
            AIRPORTS_COLLECTION_ID,
            OPENAIP_COPYRIGHT,
            // About 47,000, almost half of them in the US
            getPointStreams(/* zoom= */ 7, /* indexBottom= */ 6),
            locations),
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
            'aviation/navaids',
            'Navaids',
            NAVAIDS_COLLECTION_ID,
            OPENAIP_COPYRIGHT,
            // About 4,900, which is as many as the European air quality stations
            getPointStreams(/* zoom= */ 4, /* indexBottom= */ 4),
            locations),
        this.newCollectionEntry(
            'aviation/reporting_points',
            'Reporting points',
            REPORTING_POINTS_COLLECTION_ID,
            OPENAIP_COPYRIGHT,
            // About 6,000, almost all in Europe and clustered around airports
            getPointStreams(/* zoom= */ 6, /* indexBottom= */ 6),
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
            getPointStreams(/* zoom= */ 6, /* indexBottom= */ 6),
            locations),
          weatherStation: {id: 'station', reports: 'reports'},
        },
        {
          kind: 'group',
          id: 'us/faa',
          name: 'FAA',
          enabled: true,
          children: [
            this.newFaaEntry(
                'enroute_high',
                'IFR Enroute High',
                /* z= */ Z_BASE_SATELLITE,
                // See faa_charts.py#PRODUCTS
                /* maxZoom= */ 10),
            this.newFaaEntry(
                'enroute_low',
                'IFR Enroute Low',
                /* z= */ Z_BASE_SATELLITE,
                // See faa_charts.py#PRODUCTS
                /* maxZoom= */ 11),
            this.newFaaEntry(
                'sectional',
                'Sectional',
                /* z= */ Z_BASE_SATELLITE,
                // See faa_charts.py#PRODUCTS
                /* maxZoom= */ 11),
            this.newFaaEntry(
                'terminal',
                'Terminal Area',
                // Drawn over the sectional it details
                /* z= */ Z_BASE_SATELLITE + 0.1,
                // See faa_charts.py#PRODUCTS
                /* maxZoom= */ 12),
          ],
        },
      ],
    }, {
      kind: 'group',
      id: 'osm',
      name: 'OpenStreetMap',
      enabled: true,
      children: [{
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
      }, {
        kind: 'layer',
        id: 'osm/nodes',
        name: 'Nodes',
        enabled: true,
        schema: OSM_NODES_SCHEMA,
        layer: osmNodes,
        controls: NODE_KINDS.map(({key, label}) => ({kind: 'checkbox', key, label})),
        values: Object.fromEntries(NODE_KINDS.map(({key, hidden}) => [key, !hidden])),
        configure: values => {
          osmNodes.setCategories(
              NODE_KINDS.filter(({key}) => values[key]).map(({category}) => category));
        },
      }, {
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
      }],
    }, {
      kind: 'group',
      id: 'national',
      name: 'Regional',
      enabled: true,
      // Children keep their top level ids because saved view states refer to layers by id.
      children: [{
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
              // About 3,500
              getPointStreams(/* zoom= */ 4, /* indexBottom= */ 4),
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
              [{minZoom: 0, maxZoom: undefined, indexBottom: 4, fromLevel: 0, toLevel: undefined}],
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
        id: 'fr',
        name: 'France',
        enabled: true,
        children: [
          this.newIgnEntry(
              'fr/orthophotos', 'Orthophotos', 'BD ORTHO orthophotos', 'ORTHOIMAGERY.ORTHOPHOTOS',
              'image/jpeg'),
          this.newIgnEntry(
              'fr/plan_ign', 'Plan IGN', 'Plan IGN v2', 'GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2',
              'image/png'),
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
                [{
                  minZoom: 0,
                  maxZoom: undefined,
                  indexBottom: 4,
                  fromLevel: 0,
                  toLevel: undefined,
                }],
                locations),
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
                [{
                  minZoom: 0,
                  maxZoom: undefined,
                  indexBottom: 4,
                  fromLevel: 0,
                  toLevel: undefined,
                }],
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
                // About 11,500
                getPointStreams(/* zoom= */ 6, /* indexBottom= */ 6),
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
        this.newCollectionEntry(
            'us/usfs_mvum',
            'USFS MVUM',
            MOTOR_VEHICLE_USE_COLLECTION_ID,
            {
              long: 'Motor Vehicle Use Maps from the USDA Forest Service',
              short: 'USFS MVUM',
              url: 'https://data.fs.usda.gov/geodata/edw/datasets.php',
              publicDomain: true,
            },
            [{minZoom: 10, maxZoom: undefined, indexBottom: 8, fromLevel: 0, toLevel: undefined}],
            locations),
        ],
      }],
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
          this.newGoesEntry('East', 'FireTemp', 'fire temperature'),
          this.newGoesEntry('East', 'GeoColor', 'GeoColor'),
          this.newGoesEntry('West', 'FireTemp', 'fire temperature'),
          this.newGoesEntry('West', 'GeoColor', 'GeoColor'),
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
          {kind: 'checkbox', key: 'fill_clouds', label: 'Fill clouds', setting: true},
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
      name: 'Sky',
      enabled: true,
      children: [
        this.newSwitchedWeatherEntry(
            'weather/turbulence',
            'Clear air turbulence',
            [altitudeControl([[400, 300], [300, 250], [250, 200], [200, 150]].map(
                ([bottom, top]) => ({
                  value: `${bottom}_${top}`,
                  label: `${FLIGHT_LEVELS[bottom]} to ${FLIGHT_LEVELS[top]}`,
                })))],
            {altitude: '400_300'},
            values => {
              const [bottom, top] = String(values.altitude).split('_').map(Number);
              return {
                view: `turbulence_${values.altitude}` as WeatherView,
                name: `Turbulence, ${FLIGHT_LEVELS[bottom]} to ${FLIGHT_LEVELS[top]}`,
              };
            }),
        this.newSwitchedWeatherEntry(
            'weather/clouds',
            'Clouds',
            [{
              kind: 'select',
              key: 'height',
              label: 'Height',
              options: CLOUD_HEIGHTS.map(({view, label}) => ({value: view, label})),
            }],
            {height: 'clouds'},
            values => checkExists(CLOUD_HEIGHTS.find(({view}) => view === values.height))),
        this.newWeatherEntry('dew_point', 'Dew point'),
        this.newWeatherEntry('freezing', 'Freezing altitude'),
        this.newWeatherEntry('humidity', 'Humidity'),
        this.newSwitchedWeatherEntry(
            'weather/icing',
            'Icing',
            [altitudeControl([850, 700, 600, 500, 400, 300].map(level => ({
              value: String(level),
              label: FLIGHT_LEVELS[level],
            })))],
            {altitude: '850'},
            values => ({
              view: `icing_${values.altitude}` as WeatherView,
              name: `Icing at ${FLIGHT_LEVELS[Number(values.altitude)]}`,
            })),
        this.newWeatherEntry('pressure', 'Pressure'),
        this.newSwitchedWeatherEntry(
            'weather/rain',
            'Rain and thunder',
            [lookaheadControl('accumulation', 'Accumulation')],
            {accumulation: 'none'},
            values => values.accumulation === 'none'
                ? {view: 'precipitation', name: 'Rain and thunder'}
                : lookaheadView('rain', 'Rain', values.accumulation)),
        this.newSwitchedWeatherEntry(
            'weather/snow',
            'Snow',
            [lookaheadControl('accumulation', 'Accumulation')],
            {accumulation: 'none'},
            values => values.accumulation === 'none'
                ? {view: 'snow_depth', name: 'Snow depth'}
                : lookaheadView('snowfall', 'Snow', values.accumulation)),
        {
          kind: 'layer',
          id: SKY_LAYER_ID,
          name: 'Sun and moon',
          enabled: false,
          layer: this.sky,
          controls: [
            {kind: 'checkbox', key: 'sunlight', label: 'Sunlight shading'},
            {kind: 'checkbox', key: 'moonlight', label: 'Moonlight shading'},
            {
              kind: 'select',
              key: 'viewshed',
              label: 'Viewshed',
              options: [
                {value: 'none', label: 'None'},
                {value: 'pin', label: 'From pin'},
                {value: 'subject', label: 'Of subject'},
              ],
            },
          ],
          values: {viewshed: 'none', sunlight: false, moonlight: false},
          timed: 'any',
          persisted: ['pin', 'subject'],
          configure: values => {
            this.sky.setPins(
                typeof values.pin === 'string' ? values.pin : undefined,
                typeof values.subject === 'string' ? values.subject : undefined);
            this.sky.setViewshed(values.viewshed as ViewshedMode);
            this.sky.setSunlight(values.sunlight === true);
            this.sky.setMoonlight(values.moonlight === true);
          },
          onShown: () => {
            this.sky.appear();
          },
          // Only a click on a pin, so that the rows describe what the rays show
          readings: point => this.sky.getReadingsNear(point, this.time ?? Date.now()),
        },
        this.newWeatherEntry('temperature', 'Temperature'),
        this.newWeatherEntry('thermals', 'Thermals'),
        this.newWeatherEntry('waves', 'Waves'),
        this.newWeatherEntry('wet_bulb', 'Wet-bulb temperature'),
        this.newWindEntry(),
      ],
    }, {
      kind: 'group',
      id: 'topography',
      name: 'Terrain',
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
            /* decode= */ 'hillshade',
        ),
        controls: [],
        values: {},
      }, {
        kind: 'layer',
        id: 'topography/slopes',
        name: 'Slope angles',
        enabled: false,
        layer: new SlopeLayer([MAPTERHORN_COPYRIGHT], Z_BASE_SLOPE, this.renderer),
        controls: [],
        values: {},
      }],
    }];
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
    this.showLatestFaaCharts();
    this.showLatestSnow();
    this.showLatestWeather();
    this.conditionsRefresh.start();
  }

  private newContourLayer(system: UnitSystem): MbtileLayer {
    const archive = system === 'imperial' ? 'contours_ft' : 'contours_m';
    return new MbtileLayer(
        [COPERNICUS_DEM_COPYRIGHT, NASADEM_COPYRIGHT],
        'https://tiles.trailcatalog.org/${archive}/${id.zoom}/${id.x}/${id.y}.mvt'
            .replace('${archive}', archive),
        system === 'imperial' ? CONTOURS_FEET : CONTOURS_METERS,
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
      streams: Stream[],
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
          streams,
          locations,
          this.camera,
          this.renderer,
      ),
      controls: [],
      values: {},
    };
  }

  private newFaaEntry(product: FaaProduct, name: string, z: number, maxZoom: number): LayerEntry {
    let url = faaUrl(product, this.faaCycles[product]);
    const layer =
        new RasterTileLayer(
            [FAA_COPYRIGHT],
            url,
            /* tint= */ 0xFFFFFFFF as RgbaU32,
            z,
            /* extraZoom= */ 0,
            /* minZoom= */ 0,
            maxZoom,
            this.renderer);
    return {
      kind: 'layer',
      id: faaEntryId(product),
      name,
      enabled: false,
      layer,
      controls: [],
      values: {},
      configure: () => {
        // setUrl drops every loaded tile, so we only call it when the URL changes.
        const next = faaUrl(product, this.faaCycles[product]);
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

  // Points each FAA layer at the cycle in effect, or the one before it while ours is late. Every
  // archive has the 0/0/0 tile, see faa_charts.py#write_tiles.
  private showLatestFaaCharts(): void {
    for (const product of FAA_PRODUCTS) {
      const tryCycle = (offset: number) => {
        if (offset < -1) {
          return;
        }
        const cycle = faaCycle(offset);
        fetch(`${FAA_TILES_URL}${product}_${cycle}/0/0/0.webp`).then(response => {
          if (!response.ok) {
            tryCycle(offset - 1);
            return;
          }
          this.faaCycles[product] = cycle;
          this.configureEntries(id => id === faaEntryId(product));
        }, () => {});
      };
      tryCycle(0);
    }
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

  get forecastStart(): number {
    return this.ecmwfRun;
  }

  get forecastEnd(): number {
    return this.ecmwfRun + ECMWF_MAX_STEP * HOUR_MS;
  }

  /**
   * Points the weather layers at the step nearest a time in ms, and the sun and moon at the time.
   * Undefined follows the clock, so the viewer calls this again as the clock moves.
   */
  setTime(time: number|undefined): void {
    this.time = time;
    this.sky.setTime(time ?? Date.now());
    this.configureEntries(id => id.startsWith('weather/'));
  }

  setInteractive(interactive: boolean): void {
    this.sky.setInteractive(interactive);
  }

  /** Moves the sun and moon to a time in ms without touching the weather. */
  previewTime(time: number): void {
    this.sky.setTime(time);
  }

  // The step nearest the map's time and the next few, so that playing swaps to loaded tiles
  private getWeatherSteps(archive: EcmwfLayer): {url: string; upcoming: string[]} {
    const step = getEcmwfStep(this.ecmwfRun, this.time ?? Date.now(), archive);
    const {stepHours} = ECMWF_LAYERS[archive];
    const upcoming = [];
    const last = Math.min(step + PREFETCH_STEPS * stepHours, getLastStep(archive));
    for (let next = step + stepHours; next <= last; next += stepHours) {
      upcoming.push(ecmwfStepUrl(this.ecmwfRun, archive, next));
    }
    return {url: ecmwfStepUrl(this.ecmwfRun, archive, step), upcoming};
  }

  private getNextStepTime(at: number, archive: EcmwfLayer): number|undefined {
    const {stepHours} = ECMWF_LAYERS[archive];
    const fromRun = (at - this.ecmwfRun) / HOUR_MS;
    const next = Math.max(Math.floor(fromRun / stepHours) + 1, 0) * stepHours;
    return next <= getLastStep(archive) ? this.ecmwfRun + next * HOUR_MS : undefined;
  }

  private configureEntries(matches: (id: string) => boolean): void {
    for (const {entry} of layerEntries(this.current())) {
      if (matches(entry.id)) {
        entry.configure?.(entry.values);
      }
    }
  }

  private newWeatherEntry(view: WeatherView, name: string): LayerEntry {
    return this.newSwitchedWeatherEntry(`weather/${view}`, name, [], {}, () => ({view, name}));
  }

  // An entry whose controls pick which view it shows. Pick also names the view's readings.
  private newSwitchedWeatherEntry(
      id: string,
      name: string,
      controls: LayerControl[],
      values: ControlValues,
      pick: (values: ControlValues) => {view: WeatherView; name: string}): LayerEntry {
    let picked = pick(values);
    const layer = new SwitchLayer(picked.view, (view: WeatherView) => {
      const {url, upcoming} = this.getWeatherSteps(WEATHER_VIEWS[view].layer);
      return new StepLayer(
          url,
          upcoming,
          stepUrl =>
              new RasterTileLayer(
                  [ECMWF_COPYRIGHT],
                  stepUrl,
                  /* tint= */ 0xFFFFFFFF as RgbaU32,
                  /* z= */ Z_OVERLAY_TERRAIN,
                  /* extraZoom= */ 0,
                  /* minZoom= */ 0,
                  // See Weather.kt#MAX_ZOOM
                  /* maxZoom= */ 3,
                  this.renderer,
                  `weather/${view}`));
    });
    return {
      kind: 'layer',
      id,
      name,
      enabled: false,
      layer,
      controls,
      values,
      timed: 'forecast',
      readout: {
        get name() {
          return picked.name;
        },
        read: point => {
          const packed = layer.current.current.packedAt(point);
          return packed !== undefined ? readWeather(picked.view, packed) : undefined;
        },
      },
      nextTime: at => this.getNextStepTime(at, WEATHER_VIEWS[picked.view].layer),
      configure: values => {
        picked = pick(values);
        layer.show(picked.view);
        const {url, upcoming} = this.getWeatherSteps(WEATHER_VIEWS[picked.view].layer);
        layer.current.show(url, upcoming);
      },
    };
  }

  // Wind or gust speed colors at an altitude, or the strongest to come there, with streamlines or
  // barbs over them
  private newWindEntry(): LayerEntry {
    const pick = (values: ControlValues): {view: WeatherView; name: string} => {
      const level = FLIGHT_LEVELS[Number(values.altitude)];
      const [prefix, now, strongest] =
          values.type === 'gusts'
              ? ['gust', 'Wind gusts', 'Strongest gust']
              : values.altitude === 'ground'
                  ? ['wind', 'Wind', 'Strongest wind']
                  : [`wind_${values.altitude}`, `Wind at ${level}`, `Strongest wind at ${level}`];
      return values.peak === 'none'
          ? {view: prefix as WeatherView, name: now}
          : lookaheadView(`${prefix}_peak`, strongest, values.peak);
    };
    // Every wind view colors its archive's u and v, so the arrows draw the same archive.
    const archive = (values: ControlValues) => WEATHER_VIEWS[pick(values).view].layer;
    const values = {type: 'sustained', altitude: 'ground', peak: 'none', arrows: 'streamlines'};
    const type: LayerControl = {
      kind: 'select',
      key: 'type',
      label: 'Type',
      options: [{value: 'sustained', label: 'Sustained'}, {value: 'gusts', label: 'Gusts'}],
    };
    const altitude =
        altitudeControl(
            [
              {value: 'ground', label: 'Ground'},
              ...WIND_LEVELS.map(level => ({value: String(level), label: FLIGHT_LEVELS[level]})),
            ],
            // ECMWF only forecasts gusts at 10 m.
            values => values.type !== 'gusts');
    const peak = lookaheadControl('peak', 'Strongest');
    const speed =
        this.newSwitchedWeatherEntry('weather/wind', 'Wind', [type, altitude, peak], values, pick);
    let style: WindStyle|undefined = 'streamlines';
    const {url, upcoming} = this.getWeatherSteps(archive(values));
    const vectors =
        new StepLayer(
            url,
            upcoming,
            stepUrl => {
              const layer =
                  new WindVectorLayer(
                      [ECMWF_COPYRIGHT],
                      stepUrl,
                      /* z= */ Z_OVERLAY_TERRAIN + 0.5,
                      // See Weather.kt#MAX_ZOOM
                      /* maxZoom= */ 3,
                      this.renderer);
              layer.setStyle(style);
              return layer;
            });
    return {
      ...speed,
      layer: new CompositeLayer([speed.layer, vectors]),
      controls: [type, altitude, {
        kind: 'select',
        key: 'arrows',
        label: 'Arrows',
        options: [
          {value: 'none', label: 'None'},
          {value: 'streamlines', label: 'Streamlines'},
          {value: 'barbs', label: 'Barbs'},
        ],
      }, peak],
      configure: values => {
        speed.configure?.(values);
        const arrows = values.arrows;
        style = arrows === 'streamlines' || arrows === 'barbs' ? arrows : undefined;
        for (const layer of vectors.all) {
          layer.setStyle(style);
        }
        const {url, upcoming} = this.getWeatherSteps(archive(values));
        vectors.show(url, upcoming);
      },
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
        this.runChanged();
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
// Streams for a collection whose importer puts every point in a level 13 cell, like
// AviationVectors.kt and Conditions.kt. Below zoom they tile at level 3, where the whole world is
// 384 cells, so a world view costs at most a few hundred requests. From zoom on they tile at
// indexBottom so that a zoomed in view doesn't pull points from far offscreen.
function getPointStreams(zoom: number, indexBottom: number): Stream[] {
  return [
    {minZoom: 0, maxZoom: zoom, indexBottom: 3, fromLevel: 13, toLevel: 13},
    {minZoom: zoom, maxZoom: undefined, indexBottom, fromLevel: 13, toLevel: 13},
  ];
}

function faaCycle(offset: number): string {
  const cycleMs = FAA_CYCLE_DAYS * 24 * HOUR_MS;
  const index = Math.floor((Date.now() - FAA_CYCLE_EPOCH_MS) / cycleMs) + offset;
  return new Date(FAA_CYCLE_EPOCH_MS + index * cycleMs).toISOString().substring(0, 10);
}

function faaEntryId(product: FaaProduct): string {
  return `us/faa_${product}`;
}

function faaUrl(product: FaaProduct, cycle: string): string {
  return `${FAA_TILES_URL}${product}_${cycle}/\${id.zoom}/\${id.x}/\${id.y}.webp`;
}

// Today plus offset days, as a UTC date because SNODAS days are UTC
function utcDay(offset: number): string {
  return new Date(Date.now() + offset * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);
}

function altitudeControl(
    options: Array<{value: string; label: string}>,
    appliesTo?: (values: ControlValues) => boolean): LayerControl {
  return {kind: 'select', key: 'altitude', label: 'Altitude', options, appliesTo};
}

function lookaheadControl(key: string, label: string): LayerControl {
  return {
    kind: 'select',
    key,
    label,
    options: [
      {value: 'none', label: 'At map time'},
      ...LOOKAHEAD_WINDOWS.map(([hours, label]) =>
          ({value: String(hours), label: `Next ${label}`})),
    ],
  };
}

function lookaheadView(prefix: string, what: string, window: ControlValues[string]):
    {view: WeatherView; name: string} {
  const [, label] = checkExists(LOOKAHEAD_WINDOWS.find(([hours]) => String(hours) === window));
  return {view: `${prefix}_${window}` as WeatherView, name: `${what}, next ${label}`};
}

// The step nearest to at, or the last one the archive has
function getEcmwfStep(run: number, at: number, archive: EcmwfLayer): number {
  const {stepHours} = ECMWF_LAYERS[archive];
  const fromRun = (at - run) / HOUR_MS;
  return Math.min(Math.max(Math.round(fromRun / stepHours) * stepHours, 0), getLastStep(archive));
}

// A lookahead needs the hours after its step, so it stops that much short of the run's end.
function getLastStep(archive: EcmwfLayer): number {
  const {lookaheadHours, stepHours}: {lookaheadHours?: number; stepHours: number} =
      ECMWF_LAYERS[archive];
  const last = ECMWF_MAX_STEP - (lookaheadHours ?? 0);
  return last - last % stepHours;
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
