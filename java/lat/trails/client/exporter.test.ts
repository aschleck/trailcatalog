import { EditableFeature } from './features';
import { toGeoJson, toGpx } from './exporter';
import { parseGeoJson } from './geojson';
import { parseGpx } from './gpx';
import { CollectionSchema, DEFAULT_COLLECTION_SCHEMA } from './schema';

const FOLDER: EditableFeature = {
  kind: 'folder',
  id: 'folder',
  version: 3n,
  data: {name: 'Days'},
};

const LINE: EditableFeature = {
  kind: 'line',
  id: 'line',
  version: 3n,
  data: {name: 'Day 1', folder_id: 'folder', stroke: '#ff0000', width_px: 4},
  latLngE7: Int32Array.from([457368858, 67797574, 457368553, 67797527]),
  elevationCentimeters: Int32Array.from([178800, 178950]),
  timeSeconds: BigInt64Array.from([1787497600n, 1787497601n]),
};

const POINT: EditableFeature = {
  kind: 'point',
  id: 'point',
  version: 3n,
  data: {name: 'Les Houches', description: 'Start', fill: '#00ff00', icon: '⛺'},
  latE7: 458898737,
  lngE7: 67979193,
  elevationCentimeters: undefined,
};

test('GeoJSON reads back as what was written', () => {
  const [folder, line, point] = parseGeoJson(toGeoJson([FOLDER, LINE, POINT]));
  expect(folder).toEqual({...FOLDER, id: expect.any(String), version: 0n});
  expect(line).toEqual({
    ...LINE,
    id: expect.any(String),
    version: 0n,
    data: {...LINE.data, folder_id: folder.id},
    // GeoJSON positions carry no time
    timeSeconds: undefined,
  });
  expect(point).toEqual({...POINT, id: expect.any(String), version: 0n});
});

test('GeoJSON keeps a marker stroke a marker', () => {
  const marker = {...LINE, data: {marker_zoom: 14.5, width_px: 4.5}};
  const [line] = parseGeoJson(toGeoJson([marker]));
  expect(line.data).toEqual({marker_zoom: 14.5, width_px: 4.5});
});

test('GeoJSON writes the description field and other fields under their labels', () => {
  const schema: CollectionSchema = {
    ...DEFAULT_COLLECTION_SCHEMA,
    fields: [
      ...DEFAULT_COLLECTION_SCHEMA.fields.filter(f => f.id !== 'description'),
      {id: 'notes', label: 'Notes', type: 'text', multiline: true},
      {id: 'nights', label: 'Nights', type: 'number'},
      {id: 'booked', label: 'Booked', type: 'checkbox'},
      {
        id: 'site',
        label: 'Site',
        type: 'select',
        options: [{id: 'a', label: 'Lakeside'}],
      },
    ],
  };
  const camp = {
    ...POINT,
    data: {...POINT.data, notes: 'Quiet', nights: 2, booked: true, site: 'a'},
  };
  const {features: [{properties}]} = JSON.parse(toGeoJson([camp], schema));
  expect(properties).toEqual({
    'title': 'Les Houches',
    'description': 'Quiet',
    'marker-color': '#00ff00',
    'marker-symbol': '⛺',
    'Nights': 2,
    'Booked': true,
    'Site': 'Lakeside',
  });
});

test('GPX reads back as what was written, less what GPX cannot hold', () => {
  const [point, line] = parseGpx(toGpx([FOLDER, LINE, POINT]));
  expect(point).toEqual({
    ...POINT,
    id: expect.any(String),
    version: 0n,
    data: {name: 'Les Houches', description: 'Start'},
  });
  expect(line).toEqual({
    ...LINE,
    id: expect.any(String),
    version: 0n,
    data: {name: 'Day 1'},
  });
});

test('GPX puts waypoints before tracks', () => {
  const gpx = toGpx([LINE, POINT]);
  expect(gpx.indexOf('<wpt')).toBeLessThan(gpx.indexOf('<trk'));
});
