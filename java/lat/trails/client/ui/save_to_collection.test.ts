import { EditableLine, EditablePoint, EditablePolygon } from '../model/features';
import { DEFAULT_COLLECTION_SCHEMA } from '../model/schema';
import { copyOsmObject } from './save_to_collection';

test('copies a node as a point described by its OpenStreetMap url', () => {
  const [point] =
      copyOsmObject(
          {kind: 'point', parts: [Int32Array.of(468522000, -1217575200)]},
          {type: 'node', id: 1744903493},
          'Mount Rainier',
          DEFAULT_COLLECTION_SCHEMA) as EditablePoint[];

  expect(point.kind).toBe('point');
  expect([point.latE7, point.lngE7]).toEqual([468522000, -1217575200]);
  expect(point.data.name).toBe('Mount Rainier');
  expect(point.data.description).toBe('https://www.openstreetmap.org/node/1744903493');
  expect(point.data.folder_id).toBeUndefined();
});

test('copies a single run as one line', () => {
  const run = Int32Array.of(1, 2, 3, 4);
  const copied =
      copyOsmObject(
          {kind: 'line', parts: [run]},
          {type: 'way', id: 7},
          'Path',
          DEFAULT_COLLECTION_SCHEMA);

  expect(copied).toHaveLength(1);
  expect((copied[0] as EditableLine).latLngE7).toBe(run);
});

test('puts every exterior ring of a relation in a folder named after it', () => {
  const copied =
      copyOsmObject(
          {
            kind: 'polygon',
            parts: [Int32Array.of(0, 0, 0, 1, 1, 0), Int32Array.of(5, 5, 5, 6, 6, 5)],
          },
          {type: 'relation', id: 9},
          'Islands',
          DEFAULT_COLLECTION_SCHEMA);

  expect(copied.map(f => f.kind)).toEqual(['folder', 'polygon', 'polygon']);
  const [folder, ...rings] = copied as [EditablePolygon, ...EditablePolygon[]];
  expect(folder.data.name).toBe('Islands');
  for (const ring of rings) {
    expect(ring.data.folder_id).toBe(folder.id);
    expect(ring.data.description).toBe('https://www.openstreetmap.org/relation/9');
  }
});

test('copies nothing from an object without geometry', () => {
  expect(
      copyOsmObject(
          {kind: 'polygon', parts: []},
          {type: 'relation', id: 9},
          undefined,
          DEFAULT_COLLECTION_SCHEMA))
      .toEqual([]);
});
