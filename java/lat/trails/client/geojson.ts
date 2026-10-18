import {
  EditableFeature,
  EditableLine,
  EditablePoint,
  EditablePolygon,
  FeatureData,
  importableIcon,
} from './features';

type Json = null|boolean|number|string|Json[]|{[key: string]: Json};
type JsonObject = {[key: string]: Json};

/**
 * Reads a GeoJSON FeatureCollection or Feature into folders, lines, points, and polygons.
 *
 * Features get fresh ids, or else importing a file twice into one collection would reuse ids the
 * first import already saved. A polygon keeps only its exterior ring, because an editable polygon
 * has one ring.
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
    } else if (geometry.type === 'Polygon') {
      const polygon = parsePolygon(id, data, properties, geometry.coordinates);
      if (polygon) {
        parsed.push(polygon);
      }
    } else if (geometry.type === 'MultiPolygon' && Array.isArray(geometry.coordinates)) {
      // Like a MultiLineString, every part but the first needs its own id.
      geometry.coordinates.forEach((part, i) => {
        const polygon =
            parsePolygon(i === 0 ? id : crypto.randomUUID(), data, properties, part);
        if (polygon) {
          parsed.push(polygon);
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

  const fill = colorOf(properties['marker-color'], undefined);
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

  const stroke = colorOf(properties.stroke, properties['stroke-opacity']);
  if (stroke !== undefined) {
    data.stroke = stroke;
  }
  const width = properties['stroke-width'];
  if (typeof width === 'number' && width > 0) {
    data.width_px = width;
  }
  const markerZoom = properties.markerZoom;
  if (typeof markerZoom === 'number') {
    data.marker_zoom = markerZoom;
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

// https://datatracker.ietf.org/doc/html/rfc7946#section-3.1.6
function parsePolygon(
    id: string, data: FeatureData, properties: JsonObject, coordinates: Json):
        EditablePolygon|undefined {
  const exterior = Array.isArray(coordinates) ? coordinates[0] : undefined;
  // Four positions with the last repeating the first, so a triangle at least
  if (!Array.isArray(exterior) || exterior.length < 4) {
    return undefined;
  }

  const count = exterior.length - 1;
  const latLngE7 = new Int32Array(2 * count);
  for (let i = 0; i < count; ++i) {
    const position = positionOf(exterior[i]);
    if (!position) {
      return undefined;
    }

    latLngE7[2 * i] = Math.round(position[1] * 1e7);
    latLngE7[2 * i + 1] = Math.round(position[0] * 1e7);
  }

  const polygonData = {...data};
  const fill = colorOf(properties.fill, properties['fill-opacity']);
  if (fill !== undefined) {
    polygonData.fill = fill;
  }
  const stroke = colorOf(properties.stroke, properties['stroke-opacity']);
  if (stroke !== undefined) {
    polygonData.stroke = stroke;
  }
  const width = properties['stroke-width'];
  if (typeof width === 'number' && width > 0) {
    polygonData.width_px = width;
  }

  return {kind: 'polygon', id, version: 0n, data: polygonData, latLngE7};
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

// Simplestyle colors are #rgb or #rrggbb, with opacity from 0 to 1 in a property of its own.
// https://github.com/mapbox/simplestyle-spec/tree/master/1.1.0
function colorOf(value: Json|undefined, opacity: Json|undefined): string|undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim().toLowerCase();
  const hex =
      /^#[0-9a-f]{3}$/.test(trimmed)
          ? `#${[...trimmed.slice(1)].map(c => c + c).join('')}`
          : trimmed;
  if (!/^#[0-9a-f]{6}$/.test(hex)) {
    return undefined;
  }
  if (typeof opacity !== 'number' || !(opacity >= 0 && opacity < 1)) {
    return hex;
  }
  return hex + Math.round(opacity * 255).toString(16).padStart(2, '0');
}

/** Splits a #rrggbb or #rrggbbaa color into simplestyle's opaque color and its opacity. */
export function toSimplestyleColor(hex: string): {color: string; opacity: number|undefined} {
  return hex.length === 9
      ? {color: hex.slice(0, 7), opacity: parseInt(hex.slice(7), 16) / 255}
      : {color: hex, opacity: undefined};
}

function stringOf(value: Json|undefined): string|undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function isObject(value: Json|undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
