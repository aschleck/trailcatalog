import { EditablePoint } from './features';
import { SaveEntry, SaveQueue } from './save_queue';

test('saves features in the order they were written', async () => {
  const saved: string[][] = [];
  const queue = new SaveQueue(entries => {
    saved.push(entries.map(describe));
    return Promise.resolve(1n);
  }, unexpected);

  queue.write('put', [point('a'), point('b')]);
  queue.write('delete', [point('c')]);
  await settle();

  expect(saved).toEqual([['put a', 'put b', 'delete c']]);
});

test('orders a feature by its last write', async () => {
  const saved: string[][] = [];
  const queue = new SaveQueue(entries => {
    saved.push(entries.map(describe));
    return Promise.resolve(1n);
  }, unexpected);

  const folder = point('folder');
  const child = point('child');
  queue.write('put', [folder, child]);
  queue.write('delete', [child, folder]);
  await settle();

  expect(saved).toEqual([['delete child', 'delete folder']]);
});

test('stamps the batch version onto what it saved', async () => {
  const queue = new SaveQueue(() => Promise.resolve(7n), unexpected);

  const a = point('a');
  queue.write('put', [a]);
  await settle();

  expect(a.version).toBe(7n);
});

test('keeps a failed batch for the next flush', async () => {
  const saved: string[][] = [];
  let failing = true;
  const failures: unknown[] = [];
  const queue = new SaveQueue(entries => {
    saved.push(entries.map(describe));
    return failing ? Promise.reject(new Error('Nobody signed in')) : Promise.resolve(1n);
  }, e => {
    failures.push(e);
  });

  queue.write('put', [point('a'), point('b')]);
  await settle();
  expect(failures.length).toBe(1);

  failing = false;
  queue.flush();
  await settle();
  expect(saved).toEqual([['put a', 'put b'], ['put a', 'put b']]);
});

test('saves a feature again when it was written during its batch', async () => {
  const saved: string[][] = [];
  const versions: bigint[] = [];
  let finish = (version: bigint) => {};
  const queue = new SaveQueue(entries => {
    saved.push(entries.map(describe));
    versions.push(entries[0].feature.version);
    return new Promise(resolve => {
      finish = resolve;
    });
  }, unexpected);

  const a = point('a');
  queue.write('put', [a]);
  await settle();
  queue.write('delete', [a]);
  finish(3n);
  await settle();
  finish(4n);
  await settle();

  expect(saved).toEqual([['put a'], ['delete a']]);
  expect(versions).toEqual([0n, 3n]);
  expect(a.version).toBe(4n);
});

test('saves a feature once when flushed while its batch is in flight', async () => {
  const saved: string[][] = [];
  let finish = (version: bigint) => {};
  const queue = new SaveQueue(entries => {
    saved.push(entries.map(describe));
    return new Promise(resolve => {
      finish = resolve;
    });
  }, unexpected);

  queue.write('put', [point('a')]);
  await settle();
  queue.flush();
  finish(1n);
  await settle();

  expect(saved).toEqual([['put a']]);
});

test('forgets what it was holding on clear', async () => {
  const saved: string[][] = [];
  const queue = new SaveQueue(entries => {
    saved.push(entries.map(describe));
    return Promise.reject(new Error('Nobody signed in'));
  }, () => {});

  queue.write('put', [point('a')]);
  await settle();
  queue.clear();
  queue.flush();
  await settle();

  expect(saved).toEqual([['put a']]);
});

function point(id: string): EditablePoint {
  return {
    kind: 'point',
    id,
    version: 0n,
    data: {},
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
