import { EditableFeature, EditableLine, EditablePoint, FeatureData, importableIcon } from './features';

type Json = null|boolean|number|string|Json[]|{[key: string]: Json};
type JsonObject = {[key: string]: Json};

/**
 * Reads a GeoJSON FeatureCollection or Feature into folders, lines, and points.
 *
 * Features get fresh ids, or else importing a file twice into one collection would reuse ids the
 * first import already saved. Polygons are dropped because nothing draws them yet.
 */
export function parseGeoJson(text: string): EditableFeature[] {
  const root = JSON.parse(text) as Json;
  if (!isObject(root)) {
    throw new Error('GeoJSON has to be an object');
  }

  let features: Json[];
  if (root.type === 'FeatureCollection' && Array.isArray(root.features)) {
    features = root.features;
  } else if (root.type === 'Feature') {
    features = [root];
  } else {
    throw new Error('Unable to find any features');
  }

  // Folders may come after the features inside them, so every id is minted before any feature is
  // read.
  const ids = new Map<string, string>();
  for (const feature of features) {
    if (isObject(feature) && typeof feature.id === 'string') {
      ids.set(feature.id, crypto.randomUUID());
    }
  }

  const parsed: EditableFeature[] = [];
  for (const feature of features) {
    if (!isObject(feature) || feature.type !== 'Feature') {
      continue;
    }

    const properties = isObject(feature.properties) ? feature.properties : {};
    const id = (typeof feature.id === 'string' ? ids.get(feature.id) : undefined)
        ?? crypto.randomUUID();
    const data = commonData(properties, ids);
    const geometry = feature.geometry;
    if (!isObject(geometry)) {
      if (properties.class === 'Folder') {
        parsed.push({kind: 'folder', id, version: 0n, data});
      }
      continue;
    }

    if (geometry.type === 'Point') {
      const point = parsePoint(id, data, properties, geometry.coordinates);
      if (point) {
        parsed.push(point);
      }
    } else if (geometry.type === 'LineString') {
      const line = parseLine(id, data, properties, geometry.coordinates);
      if (line) {
        parsed.push(line);
      }
    } else if (geometry.type === 'MultiLineString' && Array.isArray(geometry.coordinates)) {
      // Every part but the first needs its own id, since each becomes its own line.
      geometry.coordinates.forEach((part, i) => {
        const line =
            parseLine(i === 0 ? id : crypto.randomUUID(), data, properties, part);
        if (line) {
          parsed.push(line);
        }
      });
    }
  }
  return parsed;
}

function commonData(properties: JsonObject, ids: Map<string, string>): FeatureData {
  const data: FeatureData = {};
  const name = stringOf(properties.title) ?? stringOf(properties.name);
  if (name !== undefined) {
    data.name = name;
  }
  const description = stringOf(properties.description);
  if (description !== undefined) {
    data.description = description;
  }
  const folder = stringOf(properties.folderId);
  if (folder !== undefined && ids.has(folder)) {
    data.folder_id = ids.get(folder);
  }
  return data;
}

// Altitudes are dropped because writers pad points with zeros, and a point's elevation is cheap to
// look up again.
function parsePoint(
    id: string, data: FeatureData, properties: JsonObject, coordinates: Json):
        EditablePoint|undefined {
  const position = positionOf(coordinates);
  if (!position) {
    return undefined;
  }

  const fill = colorOf(properties['marker-color']);
  if (fill !== undefined) {
    data.fill = fill;
  }
  const icon = importableIcon(stringOf(properties['marker-symbol']));
  if (icon !== undefined) {
    data.icon = icon;
  }

  return {
    kind: 'point',
    id,
    version: 0n,
    data,
    latE7: Math.round(position[1] * 1e7),
    lngE7: Math.round(position[0] * 1e7),
    elevationCentimeters: undefined,
  };
}

function parseLine(
    id: string, data: FeatureData, properties: JsonObject, coordinates: Json):
        EditableLine|undefined {
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    return undefined;
  }

  const latLngE7 = new Int32Array(2 * coordinates.length);
  const elevationCentimeters = new Int32Array(coordinates.length);
  // If any position is missing an altitude, we drop them from the whole line
  let haveElevations = true;
  for (let i = 0; i < coordinates.length; ++i) {
    const position = positionOf(coordinates[i]);
    if (!position) {
      return undefined;
    }

    latLngE7[2 * i] = Math.round(position[1] * 1e7);
    latLngE7[2 * i + 1] = Math.round(position[0] * 1e7);
    if (position[2] === undefined) {
      haveElevations = false;
    } else {
      elevationCentimeters[i] = Math.round(position[2] * 100);
    }
  }

  const stroke = colorOf(properties.stroke);
  if (stroke !== undefined) {
    data.stroke = stroke;
  }
  const width = properties['stroke-width'];
  if (typeof width === 'number' && width > 0) {
    data.width_px = width;
  }

  return {
    kind: 'line',
    id,
    version: 0n,
    // Copied because the parts of a MultiLineString share the properties they were read from
    data: {...data},
    latLngE7,
    elevationCentimeters: haveElevations ? elevationCentimeters : undefined,
    timeSeconds: undefined,
  };
}

// https://datatracker.ietf.org/doc/html/rfc7946#section-3.1.1
function positionOf(position: Json): [lng: number, lat: number, altitude?: number]|undefined {
  if (!Array.isArray(position) || position.length < 2) {
    return undefined;
  }

  const [lng, lat, altitude] = position;
  if (
      typeof lng !== 'number'
          || typeof lat !== 'number'
          || Math.abs(lng) > 180
          || Math.abs(lat) > 90) {
    return undefined;
  }
  const finite = typeof altitude === 'number' && Number.isFinite(altitude);
  return [lng, lat, finite ? altitude : undefined];
}

function colorOf(value: Json|undefined): string|undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const hex = value.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(hex) ? hex : undefined;
}

function stringOf(value: Json|undefined): string|undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function isObject(value: Json|undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
