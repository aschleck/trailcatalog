import { EditableFeature, EditableLine, EditablePoint } from './features';

/**
 * Writes features as a GeoJSON FeatureCollection that parseGeoJson reads back, folders included.
 */
export function toGeoJson(features: EditableFeature[]): string {
  return JSON.stringify({
    type: 'FeatureCollection',
    features: features.map(feature => {
      const properties: {[key: string]: number|string} = {};
      const {name, description, folder_id} = feature.data;
      if (name !== undefined) {
        properties.title = name;
      }
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
        if (feature.data.stroke !== undefined) {
          properties.stroke = feature.data.stroke;
        }
        if (feature.data.width_px !== undefined) {
          properties['stroke-width'] = feature.data.width_px;
        }
        geometry = {type: 'LineString', coordinates: lineCoordinates(feature)};
      } else {
        if (feature.data.fill !== undefined) {
          properties['marker-color'] = feature.data.fill;
        }
        if (feature.data.icon !== undefined) {
          properties['marker-symbol'] = feature.data.icon;
        }
        geometry = {type: 'Point', coordinates: pointCoordinates(feature)};
      }
      return {type: 'Feature', id: feature.id, geometry, properties};
    }),
  });
}

/**
 * Writes points as waypoints and lines as single segment tracks. GPX has no folders, colors, or
 * icons, so those are left behind.
 */
export function toGpx(features: EditableFeature[]): string {
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
    if (point.data.name !== undefined) {
      element(waypoint, 'name', point.data.name);
    }
    if (point.data.description !== undefined) {
      element(waypoint, 'desc', point.data.description);
    }
  }
  for (const line of features.filter(f => f.kind === 'line')) {
    const track = element(root, 'trk');
    if (line.data.name !== undefined) {
      element(track, 'name', line.data.name);
    }
    if (line.data.description !== undefined) {
      element(track, 'desc', line.data.description);
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

function pointCoordinates(point: EditablePoint): number[] {
  const position = [point.lngE7 / 1e7, point.latE7 / 1e7];
  if (point.elevationCentimeters !== undefined) {
    position.push(point.elevationCentimeters / 100);
  }
  return position;
}
