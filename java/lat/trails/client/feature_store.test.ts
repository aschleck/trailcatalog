import { Change, FeatureStore } from './feature_store';
import { EditableFeature, EditableFolder, EditablePoint, snapshot } from './features';
import { SaveEntry, SaveQueue } from './save_queue';

test('undoes and redoes an edit', async () => {
  const {saved, store} = setUp();
  const a = point('a', {name: 'before'});
  store.apply([create(a)]);
  await settle();

  store.apply([{
    id: 'a',
    before: snapshot(a),
    after: {...snapshot(a), data: {name: 'after'}},
  }]);
  store.undo();
  await settle();
  expect(store.get('a')?.data.name).toBe('before');

  store.redo();
  await settle();
  expect(store.get('a')?.data.name).toBe('after');
  expect(saved).toEqual([['put a'], ['put a'], ['put a']]);
});

test('puts back with the version the server last stamped', async () => {
  const versions: bigint[] = [];
  let next = 1n;
  const saves = new SaveQueue(entries => {
    versions.push(...entries.map(e => e.feature.version));
    return Promise.resolve(next++);
  }, unexpected);
  const store = new FeatureStore(saves);

  const a = point('a', {});
  store.apply([create(a)]);
  await settle();
  store.apply([{id: 'a', before: snapshot(a), after: undefined}]);
  await settle();
  store.undo();
  await settle();

  // Created at 0, deleted at the version the create landed at, restored at the delete's.
  expect(versions).toEqual([0n, 1n, 2n]);
  expect(store.get('a')?.version).toBe(3n);
});

test('undoes a folder delete folder first and redoes it children first', async () => {
  const {saved, store} = setUp();
  const folder = folderOf('f');
  const child = point('c', {folder_id: 'f'});
  store.reset([folder, child]);

  store.apply(
      [...store.descendants('f'), folder]
          .map(f => ({id: f.id, before: snapshot(f), after: undefined})));
  await settle();
  store.undo();
  await settle();
  store.redo();
  await settle();

  expect(saved).toEqual([
    ['delete c', 'delete f'],
    ['put f', 'put c'],
    ['delete c', 'delete f'],
  ]);
});

test('drops the redo stack on a new edit', () => {
  const {store} = setUp();
  store.apply([create(point('a', {}))]);
  store.undo();
  expect(store.canRedo).toBe(true);

  store.apply([create(point('b', {}))]);
  expect(store.canRedo).toBe(false);
});

test('puts a feature whose folder is gone at the root', () => {
  const {store} = setUp();
  const orphan = point('a', {folder_id: 'missing'});
  store.reset([orphan]);

  expect(store.children(undefined)).toEqual([orphan]);
});

function setUp(): {saved: string[][]; store: FeatureStore} {
  const saved: string[][] = [];
  const saves = new SaveQueue(entries => {
    saved.push(entries.map(describe));
    return Promise.resolve(1n);
  }, unexpected);
  return {saved, store: new FeatureStore(saves)};
}

function create(feature: EditableFeature): Change {
  return {id: feature.id, before: undefined, after: snapshot(feature)};
}

function folderOf(id: string): EditableFolder {
  return {kind: 'folder', id, version: 0n, data: {}};
}

function point(id: string, data: EditablePoint['data']): EditablePoint {
  return {
    kind: 'point',
    id,
    version: 0n,
    data,
    latE7: 0,
    lngE7: 0,
    elevationCentimeters: undefined,
  };
}

function describe(entry: SaveEntry): string {
  return `${entry.op} ${entry.feature.id}`;
}

function unexpected(e: unknown): void {
  throw e;
}

function settle(): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, 0);
  });
}
