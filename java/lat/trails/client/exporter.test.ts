import { EditableFeature } from './features';
import { toGeoJson, toGpx } from './exporter';
import { parseGeoJson } from './geojson';
import { parseGpx } from './gpx';

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
