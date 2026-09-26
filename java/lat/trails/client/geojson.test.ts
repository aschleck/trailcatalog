import { EditableFeature } from './features';
import { parseGeoJson } from './geojson';

// A folder listed after the line inside it, a line with altitudes, a line missing one, a padded
// point, a polygon to be dropped, and a MultiLineString.
const GEOJSON = JSON.stringify({
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      id: 'line-1',
      geometry: {
        type: 'LineString',
        coordinates: [[6.7797574, 45.7368858, 1788], [6.7797527, 45.7368553, 1789.5]],
      },
      properties: {
        title: 'Day 3',
        stroke: '#FF0000',
        'stroke-width': 2,
        folderId: 'folder-1',
      },
    },
    {
      type: 'Feature',
      id: 'folder-1',
      geometry: null,
      properties: {title: 'Harder', class: 'Folder'},
    },
    {
      type: 'Feature',
      id: 'line-2',
      geometry: {
        type: 'LineString',
        coordinates: [[6.8, 45.8, 1000], [6.81, 45.81]],
      },
      properties: {folderId: 'nowhere'},
    },
    {
      type: 'Feature',
      id: 'point-1',
      geometry: {type: 'Point', coordinates: [6.797919273376465, 45.889873740298555, 0, 0]},
      properties: {
        title: 'Les Houches',
        description: '',
        'marker-color': '#ff0000',
        'marker-symbol': 'point',
      },
    },
    {
      type: 'Feature',
      geometry: {type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]]},
      properties: {},
    },
    {
      type: 'Feature',
      geometry: {type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]], [[2, 2], [3, 3]]]},
      properties: {title: 'Parts'},
    },
  ],
});

test('reads folders, lines, and points', () => {
  const features = parseGeoJson(GEOJSON);
  expect(features.map(f => `${f.kind} ${f.data.name}`)).toEqual([
    'line Day 3',
    'folder Harder',
    'line undefined',
    'point Les Houches',
    'line Parts',
    'line Parts',
  ]);
});

test('reads a line', () => {
  const [line, folder] = parseGeoJson(GEOJSON);
  expect(line).toEqual({
    kind: 'line',
    id: expect.stringMatching(/^[0-9a-f-]{36}$/),
    version: 0n,
    data: {name: 'Day 3', folder_id: folder.id, stroke: '#ff0000', width_px: 2},
    latLngE7: Int32Array.from([457368858, 67797574, 457368553, 67797527]),
    elevationCentimeters: Int32Array.from([178800, 178950]),
    timeSeconds: undefined,
  });
});

test('drops altitudes the whole line does not carry', () => {
  const line = parseGeoJson(GEOJSON)[2];
  expect(line.kind === 'line' && line.elevationCentimeters).toBeUndefined();
});

test('drops a folder id that names no feature', () => {
  expect(parseGeoJson(GEOJSON)[2].data.folder_id).toBeUndefined();
});

test('reads a point without its padding', () => {
  expect(parseGeoJson(GEOJSON)[3]).toEqual({
    kind: 'point',
    id: expect.stringMatching(/^[0-9a-f-]{36}$/),
    version: 0n,
    // A symbol name like 'point' is left for the default dot
    data: {name: 'Les Houches', fill: '#ff0000'},
    latE7: 458898737,
    lngE7: 67979193,
    elevationCentimeters: undefined,
  });
});

test('keeps an emoji symbol as the icon', () => {
  const features = parseGeoJson(JSON.stringify({
    type: 'Feature',
    geometry: {type: 'Point', coordinates: [1, 2]},
    properties: {'marker-symbol': '⛺'},
  }));
  expect(features[0].data.icon).toBe('⛺');
});

test('gives every feature a fresh id', () => {
  const ids = parseGeoJson(GEOJSON).map((f: EditableFeature) => f.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids).not.toContain('line-1');
});

test('reads a lone feature', () => {
  const features = parseGeoJson(JSON.stringify({
    type: 'Feature',
    geometry: {type: 'Point', coordinates: [1, 2]},
    properties: {name: 'Alone'},
  }));
  expect(features.map(f => f.data.name)).toEqual(['Alone']);
});

test('rejects what is not GeoJSON', () => {
  expect(() => parseGeoJson('[]')).toThrow();
  expect(() => parseGeoJson('{"type": "Topology"}')).toThrow();
});
