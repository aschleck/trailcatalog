import {
  EditableFeature,
  EditableLine,
  EditablePoint,
  EditablePolygon,
  getParents,
} from './features';
import { toSimplestyleColor } from './geojson';
import {
  channelOf,
  DEFAULT_COLLECTION_SCHEMA,
  descriptionField,
  fieldsFor,
  formatField,
  getFieldKind,
  getTitle,
  titleField,
} from './schema';
import {
  CollectionSchema,
  lineLook,
  PARTS,
  pointLook,
  polygonLook,
} from './workers/collection_schema';

export type ExportFormat = 'geojson'|'gpx';

/**
 * Returns the features left after dropping excluded ids. A folder goes when it or a folder above it
 * is excluded, or when nothing under it is left, but a folder that was empty to begin with stays.
 */
export function filterForExport(
    features: EditableFeature[],
    excluded: ReadonlySet<string>): EditableFeature[] {
  const parents = getParents(features);
  const children = new Map<string|undefined, EditableFeature[]>();
  for (const feature of features) {
    const parent = parents.get(feature.id);
    const siblings = children.get(parent) ?? [];
    siblings.push(feature);
    children.set(parent, siblings);
  }

  const kept = new Set<string>();
  const visit = (parent: string|undefined, dropped: boolean): {items: boolean; kept: boolean} => {
    let items = false;
    let anyKept = false;
    for (const feature of children.get(parent) ?? []) {
      const out = dropped || excluded.has(feature.id);
      let keep = !out;
      if (feature.kind === 'folder') {
        const inside = visit(feature.id, out);
        items ||= inside.items;
        keep &&= inside.kept || !inside.items;
      } else {
        items = true;
      }
      if (keep) {
        kept.add(feature.id);
        anyKept = true;
      }
    }
    return {items, kept: anyKept};
  };
  visit(undefined, false);
  return features.filter(f => kept.has(f.id));
}

/**
 * Writes features as a GeoJSON FeatureCollection that parseGeoJson reads back, folders included.
 * Colors, widths, and icons are what the schema draws each feature with, so that other tools show
 * them the same. Every other field with a value is written under its label.
 */
export function toGeoJson(
    features: EditableFeature[], schema: CollectionSchema = DEFAULT_COLLECTION_SCHEMA): string {
  return JSON.stringify({
    type: 'FeatureCollection',
    features: features.map(feature => {
      const properties: {[key: string]: boolean|number|string} = {};
      const {folder_id} = feature.data;
      const title = getTitle(schema, feature);
      if (title !== undefined) {
        properties.title = title;
      }
      const description = descriptionOf(schema, feature);
      if (description !== undefined) {
        properties.description = description;
      }
      if (folder_id !== undefined) {
        properties.folderId = folder_id;
      }

      let geometry;
      if (feature.kind === 'folder') {
        properties.class = 'Folder';
        geometry = null;
      } else if (feature.kind === 'line') {
        const look = lineLook(schema, feature.data);
        if (look) {
          const {color, opacity} = toSimplestyleColor(look.stroke);
          properties.stroke = color;
          if (opacity !== undefined) {
            properties['stroke-opacity'] = opacity;
          }
          properties['stroke-width'] = look.widthPx;
        }
        if (feature.data.marker_zoom !== undefined) {
          properties.markerZoom = feature.data.marker_zoom;
        }
        geometry = {type: 'LineString', coordinates: lineCoordinates(feature)};
      } else if (feature.kind === 'point') {
        const look = pointLook(schema, feature.data);
        if (look) {
          // Simplestyle has no opacity for a marker.
          properties['marker-color'] = toSimplestyleColor(look.fill).color;
          properties['marker-symbol'] = look.icon;
        }
        geometry = {type: 'Point', coordinates: pointCoordinates(feature)};
      } else {
        const look = polygonLook(schema, feature.data);
        if (look) {
          const fill = toSimplestyleColor(look.fill);
          properties.fill = fill.color;
          if (fill.opacity !== undefined) {
            properties['fill-opacity'] = fill.opacity;
          }
          const stroke = toSimplestyleColor(look.stroke);
          properties.stroke = stroke.color;
          if (stroke.opacity !== undefined) {
            properties['stroke-opacity'] = stroke.opacity;
          }
          properties['stroke-width'] = look.widthPx;
        }
        geometry = {type: 'Polygon', coordinates: [ringCoordinates(feature)]};
      }
      // A label that collides with a key written above loses, since those keys are what other tools
      // read.
      for (const [label, value] of otherFields(schema, feature)) {
        properties[label] ??= value;
      }
      return {type: 'Feature', id: feature.id, geometry, properties};
    }),
  });
}

/**
 * Writes points as waypoints and lines as single segment tracks. GPX has no folders, polygons,
 * colors, or icons, so those are left behind.
 */
export function toGpx(
    features: EditableFeature[], schema: CollectionSchema = DEFAULT_COLLECTION_SCHEMA): string {
  const gpx = new DOMParser().parseFromString(
      '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="trails.lat"/>',
      'application/xml');
  const root = gpx.documentElement;
  const element = (parent: Element, tag: string, text?: string) => {
    const child = gpx.createElementNS(root.namespaceURI, tag);
    if (text !== undefined) {
      child.textContent = text;
    }
    parent.appendChild(child);
    return child;
  };

  // https://www.topografix.com/GPX/1/1/#type_gpxType puts every wpt before any trk, and each
  // type's children run ele, time, name, desc.
  for (const point of features.filter(f => f.kind === 'point')) {
    const waypoint = element(root, 'wpt');
    waypoint.setAttribute('lat', String(point.latE7 / 1e7));
    waypoint.setAttribute('lon', String(point.lngE7 / 1e7));
    if (point.elevationCentimeters !== undefined) {
      element(waypoint, 'ele', String(point.elevationCentimeters / 100));
    }
    const title = getTitle(schema, point);
    if (title !== undefined) {
      element(waypoint, 'name', title);
    }
    const description = descriptionOf(schema, point);
    if (description !== undefined) {
      element(waypoint, 'desc', description);
    }
  }
  for (const line of features.filter(f => f.kind === 'line')) {
    const track = element(root, 'trk');
    const title = getTitle(schema, line);
    if (title !== undefined) {
      element(track, 'name', title);
    }
    const description = descriptionOf(schema, line);
    if (description !== undefined) {
      element(track, 'desc', description);
    }
    const segment = element(track, 'trkseg');
    for (let i = 0; i < line.latLngE7.length / 2; ++i) {
      const point = element(segment, 'trkpt');
      point.setAttribute('lat', String(line.latLngE7[2 * i] / 1e7));
      point.setAttribute('lon', String(line.latLngE7[2 * i + 1] / 1e7));
      if (line.elevationCentimeters) {
        element(point, 'ele', String(line.elevationCentimeters[i] / 100));
      }
      if (line.timeSeconds) {
        element(point, 'time', new Date(Number(line.timeSeconds[i]) * 1000).toISOString());
      }
    }
  }
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(root);
}

function descriptionOf(schema: CollectionSchema, feature: EditableFeature): string|undefined {
  const field = descriptionField(schema, getFieldKind(feature));
  const value = field ? feature.data[field.id] : undefined;
  return typeof value === 'string' ? value : undefined;
}

// The fields not already written as the title, the description, or a color, width, or icon
function otherFields(schema: CollectionSchema, feature: EditableFeature):
    Array<[string, boolean|number|string]> {
  const kind = getFieldKind(feature);
  if (kind === 'folder') {
    return [];
  }

  const written = new Set([titleField(schema, feature), descriptionField(schema, kind)?.id]);
  for (const {part, type} of PARTS.filter(p => p.kind === kind)) {
    const channel = channelOf(schema, kind, part);
    if (type !== 'label' && type !== 'pattern' && channel.kind === 'field') {
      written.add(channel.key);
    }
  }
  return fieldsFor(schema, kind).flatMap(field => {
    const value = feature.data[field.id];
    if (value === undefined || written.has(field.id)) {
      return [];
    }
    const shown =
        field.type === 'checkbox' || field.type === 'number' ? value : formatField(field, value);
    return [[field.label, shown]];
  });
}

function lineCoordinates(line: EditableLine): number[][] {
  const coordinates = [];
  for (let i = 0; i < line.latLngE7.length / 2; ++i) {
    const position = [line.latLngE7[2 * i + 1] / 1e7, line.latLngE7[2 * i] / 1e7];
    if (line.elevationCentimeters) {
      position.push(line.elevationCentimeters[i] / 100);
    }
    coordinates.push(position);
  }
  return coordinates;
}

// GeoJSON closes a ring by repeating its first position at the end.
function ringCoordinates(polygon: EditablePolygon): number[][] {
  const coordinates = [];
  const count = polygon.latLngE7.length / 2;
  for (let i = 0; i <= count; ++i) {
    const at = i % count;
    coordinates.push([polygon.latLngE7[2 * at + 1] / 1e7, polygon.latLngE7[2 * at] / 1e7]);
  }
  return coordinates;
}

function pointCoordinates(point: EditablePoint): number[] {
  const position = [point.lngE7 / 1e7, point.latE7 / 1e7];
  if (point.elevationCentimeters !== undefined) {
    position.push(point.elevationCentimeters / 100);
  }
  return position;
}
