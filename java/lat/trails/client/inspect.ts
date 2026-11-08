import { checkExists } from 'external/dev_april_corgi+/js/common/asserts';
import { LittleEndianView } from 'external/dev_april_corgi+/js/common/little_endian_view';

import { getBoundarySource, getPointSource } from 'java/org/trailcatalog/models/categories';
import { Bytes, S2LatLng, S2Polygon } from 'java/org/trailcatalog/s2';
import {
  projectE7Deltas,
  projectS2LatLng,
  projectS2PolygonOutline,
  unprojectS2LatLng,
} from 'js/map/camera';
import { GetShapeResponse, SearchResultKind } from 'trails_lat/proto/data_pb';

import { CollectionLayer, HeldObject } from './layers/collection_layer';
import { PointCollectionLayer } from './layers/point_collection_layer';
import { ShapeLayer } from './layers/shape_layer';
import { LayerObject } from './model/events';
import { EditableFeature } from './model/features';
import { Point } from './model/points';
import { getObjectTitle, OSM_NODES_SCHEMA, OSM_WAYS_SCHEMA, Schema } from './model/schema';
import { pathLengthMeters } from './tools/measurements';
import { InspectedGeometry, InspectedObject, OsmElement } from './ui/feature_list';
import { LayerEntry } from './ui/layer_tree';
import { Choice } from './ui/pick_menu';
import { CollectionSchema } from './workers/collection_schema';
import { Data } from './workers/collection_types';

// Something a click landed on
export type Pick =
    {kind: 'feature'; feature: EditableFeature}
    |{kind: 'object'; entry: LayerEntry; layer: CollectionLayer; object: HeldObject}
    |{kind: 'point'; entry: LayerEntry; layer: PointCollectionLayer; point: Point};

export interface Inspection {
  inspected: InspectedObject;
  // A line's path for its profile, as interleaved lat then lng degrees
  path: Float64Array|undefined;
}

interface Common {
  data: Data;
  schema: Schema|CollectionSchema;
  osm: OsmElement|undefined;
  weather: InspectedObject['weather'];
}

export function getPicksIn(entry: LayerEntry, point: S2LatLng): Promise<Pick[]> {
  const layer = entry.layer;
  if (layer instanceof CollectionLayer) {
    return layer.objectsAt(point).then(objects =>
        objects.map(object => ({kind: 'object', entry, layer, object})));
  } else if (layer instanceof PointCollectionLayer) {
    return Promise.resolve(
        layer.pointsAt(point).map(value => ({kind: 'point', entry, layer, point: value})));
  } else {
    return Promise.resolve([]);
  }
}

export function getChoice(pick: Pick, featureSchema: CollectionSchema): Choice {
  if (pick.kind === 'feature') {
    return {kind: 'feature', feature: pick.feature, schema: featureSchema};
  }

  const object: LayerObject =
      pick.kind === 'object' ? pick.object : {kind: 'point', value: pick.point};
  const schema = getPickSchema(pick.entry);
  return {
    kind: 'object',
    shape: object.kind,
    title: schema && getObjectTitle(schema, {kind: object.kind, data: object.value.data}),
    source: pick.entry.name,
  };
}

// Tile geometry is simplified for the zoom the tile loaded at, so a copy is only as fine as that.
export function inspectObject(entry: LayerEntry, object: LayerObject): Inspection {
  const data = object.value.data;
  const schema = checkExists(getPickSchema(entry));
  const title = 'layers' in schema ? undefined : schema.title;
  const titleValue = title && data[title.key];
  const osm =
      typeof titleValue !== 'number' ? undefined
          : title?.kind === 'osm_point' ? getOsmElement(titleValue)
          : title?.kind === 'osm_way' ? {type: 'way' as const, id: titleValue}
          : undefined;
  const station = entry.weatherStation ? data[entry.weatherStation.id] : undefined;
  const reports = entry.weatherStation ? String(data[entry.weatherStation.reports] ?? '') : '';
  const weather =
      typeof station === 'string'
          ? {station, metar: reports.includes('METAR'), taf: reports.includes('TAF')}
          : undefined;
  const common = {data, schema, osm, weather};
  if (object.kind === 'polygon') {
    const raw = new Int8Array(object.value.raw);
    return inspect(
        common, 'polygon', [], () => S2Polygon.FAST_CODER.unsafeDecode(Bytes.fromByteArray(raw)));
  }
  const points =
      object.kind === 'line' ? object.value.points : Float64Array.from(object.value.position);
  return inspect(common, object.kind, [toDegrees(points)]);
}

/** Inspects a search result, along with how the shape layer draws it as selected. */
export function inspectShape(
    result: {kind: SearchResultKind; id: bigint},
    response: GetShapeResponse,
): Inspection & {shape: Parameters<ShapeLayer['setShape']>[0]}|undefined {
  const source =
      result.kind === SearchResultKind.TRAIL ? {type: 'relation' as const, id: result.id}
          : result.kind === SearchResultKind.POINT ? getPointSource(result.id)
          : getBoundarySource(result.id);
  const data: Data = {type: response.type};
  // A point can lack a name tag, and then the dialog names its category instead.
  if (response.name) {
    data.name = response.name;
  }
  const common = {
    data,
    schema: result.kind === SearchResultKind.POINT ? OSM_NODES_SCHEMA : OSM_WAYS_SCHEMA,
    osm: {type: source.type, id: Number(source.id)},
    weather: undefined,
  };
  const geometry = response.shape;
  if (geometry.case === 'polylines') {
    const runs = geometry.value.runs.map(bytes => {
      const end = bytes.byteOffset + bytes.byteLength;
      return projectE7Deltas(new LittleEndianView(bytes.buffer, bytes.byteOffset, end));
    });
    return {...inspect(common, 'line', runs.map(toDegrees)), shape: {kind: 'lines', runs}};
  } else if (geometry.case === 's2Polygon') {
    const polygon = S2Polygon.FAST_CODER.unsafeDecode(Bytes.fromByteArray(geometry.value));
    return {
      ...inspect(common, 'polygon', [], () => polygon),
      shape: {kind: 'outline', runs: projectS2PolygonOutline(polygon)},
    };
  } else if (geometry.case === 'point') {
    const {latDegrees, lngDegrees} = geometry.value;
    const position = projectS2LatLng(S2LatLng.fromDegrees(latDegrees, lngDegrees));
    return {
      ...inspect(common, 'point', [Float64Array.of(latDegrees, lngDegrees)]),
      shape: {kind: 'point', position},
    };
  }
  return undefined;
}

export function getPickSchema(entry: LayerEntry): Schema|CollectionSchema|undefined {
  return entry.schema
      ?? (entry.layer instanceof CollectionLayer ? entry.layer.getCollectionSchema() : undefined);
}

export function getObjectLatLngDegrees(object: LayerObject): number[] {
  if (object.kind === 'polygon') {
    const bound = object.value.bound;
    return [bound.low[0], bound.low[1], bound.high[0], bound.high[1]];
  } else if (object.kind === 'point') {
    const ll = unprojectS2LatLng(object.value.position[0], object.value.position[1]);
    return [ll.latDegrees(), ll.lngDegrees()];
  } else {
    return [...toDegrees(object.value.points)];
  }
}

export function getOsmElement(pointId: number): OsmElement {
  const {type, id} = getPointSource(BigInt(pointId));
  return {type, id: Number(id)};
}

// Mercator to interleaved lat then lng degrees
export function toDegrees(points: Float64Array): Float64Array {
  const degrees = new Float64Array(points.length);
  for (let i = 0; i < points.length; i += 2) {
    const ll = unprojectS2LatLng(points[i], points[i + 1]);
    degrees[i] = ll.latDegrees();
    degrees[i + 1] = ll.lngDegrees();
  }
  return degrees;
}

// Runs are a line's or a point's lat then lng degrees, and a polygon decodes only when copied
// because it can be a whole relation's.
function inspect(
    common: Common,
    kind: 'line'|'point'|'polygon',
    runs: Float64Array[],
    polygon?: () => S2Polygon): Inspection {
  const geometry = (): InspectedGeometry => ({
    kind,
    parts: polygon ? getExteriorRingsE7(polygon()) : runs.map(toE7),
  });
  if (kind === 'line') {
    // Across a break between runs the profile runs straight from one to the next.
    const path = new Float64Array(runs.reduce((sum, run) => sum + run.length, /* initial= */ 0));
    let lengthMeters = 0;
    let at = 0;
    for (const run of runs) {
      path.set(run, at);
      at += run.length;
      lengthMeters += pathLengthMeters(run);
    }
    return {inspected: {...common, geometry, kind, lengthMeters}, path};
  } else if (kind === 'point') {
    const [latDegrees, lngDegrees] = runs[0];
    return {inspected: {...common, geometry, kind, latDegrees, lngDegrees}, path: undefined};
  }
  return {inspected: {...common, geometry, kind}, path: undefined};
}

function getExteriorRingsE7(polygon: S2Polygon): Int32Array[] {
  const loops = polygon.getLoops();
  const rings = [];
  for (let i = 0; i < loops.size(); ++i) {
    const loop = loops.getAtIndex(i);
    if (loop.isHole()) {
      continue;
    }
    const ring = new Int32Array(2 * loop.numVertices());
    for (let v = 0; v < loop.numVertices(); ++v) {
      const ll = S2LatLng.fromPoint(loop.vertex(v));
      ring[2 * v] = Math.round(ll.latDegrees() * 1e7);
      ring[2 * v + 1] = Math.round(ll.lngDegrees() * 1e7);
    }
    rings.push(ring);
  }
  return rings;
}

function toE7(degrees: Float64Array): Int32Array {
  return Int32Array.from(degrees, d => Math.round(d * 1e7));
}
