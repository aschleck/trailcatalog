import { EditableFeature } from './features';
import { filterForExport, toGeoJson, toGpx } from './exporter';
import { parseGeoJson } from './geojson';
import { parseGpx } from './gpx';
import { DEFAULT_COLLECTION_SCHEMA } from './schema';
import { CollectionSchema, DEFAULT_COLOR } from './workers/collection_schema';

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

test('GeoJSON reads a polygon back as what was written', () => {
  const polygon: EditableFeature = {
    kind: 'polygon',
    id: 'polygon',
    version: 3n,
    data: {name: 'Camp', fill: '#00ff0080', stroke: '#0000ff', width_px: 2},
    latLngE7: Int32Array.from([457368858, 67797574, 457368553, 67797527, 457368000, 67797000]),
  };
  const [read] = parseGeoJson(toGeoJson([polygon]));
  expect(read).toEqual({...polygon, id: expect.any(String), version: 0n});
});

test('GeoJSON keeps a marker stroke a marker', () => {
  const marker = {...LINE, data: {marker_zoom: 14.5, width_px: 4.5}};
  const [line] = parseGeoJson(toGeoJson([marker]));
  expect(line.data).toEqual({marker_zoom: 14.5, stroke: DEFAULT_COLOR, width_px: 4.5});
});

test('GeoJSON writes the description field and other fields under their labels', () => {
  const schema: CollectionSchema = {
    ...DEFAULT_COLLECTION_SCHEMA,
    fields: [
      ...DEFAULT_COLLECTION_SCHEMA.fields.filter(f => f.id !== 'description'),
      {id: 'notes', kind: 'point', label: 'Notes', type: 'text', multiline: true},
      {id: 'nights', kind: 'point', label: 'Nights', type: 'number'},
      {id: 'booked', kind: 'point', label: 'Booked', type: 'checkbox'},
      {
        id: 'site',
        kind: 'point',
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

test('GeoJSON writes a translucent stroke as an opacity and reads it back', () => {
  const translucent = {...LINE, data: {...LINE.data, stroke: '#ff000080'}};
  const {features: [{properties}]} = JSON.parse(toGeoJson([translucent]));
  expect(properties.stroke).toBe('#ff0000');
  expect(properties['stroke-opacity']).toBeCloseTo(0.5, 2);
  const [line] = parseGeoJson(toGeoJson([translucent]));
  expect(line.data.stroke).toBe('#ff000080');
});

test('GeoJSON drops the opacity of a marker color', () => {
  const translucent = {...POINT, data: {...POINT.data, fill: '#00ff0080'}};
  const {features: [{properties}]} = JSON.parse(toGeoJson([translucent]));
  expect(properties['marker-color']).toBe('#00ff00');
});

test('Exporting leaves out unchecked features and everything under unchecked folders', () => {
  const inner: EditableFeature =
      {...FOLDER, id: 'inner', data: {name: 'Day 1', folder_id: 'folder'}};
  const nested: EditableFeature = {...POINT, id: 'nested', data: {folder_id: 'inner'}};
  const features = [FOLDER, inner, LINE, nested, POINT];
  expect(filterForExport(features, new Set(['folder'])).map(f => f.id))
      .toEqual(['point']);
  expect(filterForExport(features, new Set(['inner'])).map(f => f.id))
      .toEqual(['folder', 'line', 'point']);
  expect(filterForExport(features, new Set(['nested', 'point'])).map(f => f.id))
      .toEqual(['folder', 'line']);
});

test('Exporting drops a folder emptied by unchecking but keeps an empty one', () => {
  const empty: EditableFeature = {...FOLDER, id: 'empty', data: {name: 'Empty'}};
  expect(filterForExport([FOLDER, empty, LINE, POINT], new Set(['line'])).map(f => f.id))
      .toEqual(['empty', 'point']);
});

test('Exporting treats a missing folder as the root and keeps a cycle', () => {
  const orphan: EditableFeature = {...POINT, id: 'orphan', data: {folder_id: 'gone'}};
  const a: EditableFeature = {...FOLDER, id: 'a', data: {folder_id: 'b'}};
  const b: EditableFeature = {...FOLDER, id: 'b', data: {folder_id: 'a'}};
  const line: EditableFeature = {...LINE, data: {folder_id: 'b'}};
  expect(filterForExport([orphan, a, b, line], new Set()).map(f => f.id))
      .toEqual(['orphan', 'a', 'b', 'line']);
});
