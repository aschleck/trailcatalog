import { EditableLine } from './edit_layer';
import { SaveQueue } from './save_queue';

test('puts lines in the order they were saved', async () => {
  const put: string[] = [];
  const queue = new SaveQueue(line => {
    put.push(line.id);
    return Promise.resolve();
  }, unexpected);

  queue.save([line('a'), line('b')]);
  queue.save([line('c')]);
  await settle();

  expect(put).toEqual(['a', 'b', 'c']);
});

test('stops at a failure and retries on the next flush', async () => {
  const put: string[] = [];
  let failing = true;
  const failures: unknown[] = [];
  const queue = new SaveQueue(line => {
    put.push(line.id);
    return failing ? Promise.reject(new Error('Nobody signed in')) : Promise.resolve();
  }, e => {
    failures.push(e);
  });

  queue.save([line('a'), line('b')]);
  await settle();
  expect(put).toEqual(['a']);
  expect(failures.length).toBe(1);

  failing = false;
  queue.flush();
  await settle();
  expect(put).toEqual(['a', 'a', 'b']);
});

test('puts a line once when flushed while its put is in flight', async () => {
  const put: string[] = [];
  let finish = () => {};
  const queue = new SaveQueue(line => {
    put.push(line.id);
    return new Promise(resolve => {
      finish = resolve;
    });
  }, unexpected);

  queue.save([line('a')]);
  await settle();
  queue.flush();
  finish();
  await settle();

  expect(put).toEqual(['a']);
});

test('forgets what it was holding on clear', async () => {
  const put: string[] = [];
  const queue = new SaveQueue(line => {
    put.push(line.id);
    return Promise.reject(new Error('Nobody signed in'));
  }, () => {});

  queue.save([line('a')]);
  await settle();
  queue.clear();
  queue.flush();
  await settle();

  expect(put).toEqual(['a']);
});

function line(id: string): EditableLine {
  return {
    id,
    version: 0n,
    data: {},
    latLngE7: new Int32Array(0),
    elevationCentimeters: undefined,
    timeSeconds: undefined,
  };
}

function unexpected(e: unknown): void {
  throw e;
}

function settle(): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, 0);
  });
}
