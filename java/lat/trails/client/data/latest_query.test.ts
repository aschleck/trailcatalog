import { LatestQuery } from './latest_query';

test('asks about only the latest input once the one in flight lands', async () => {
  const {query, asked, answer} = harness();

  query.set(1);
  query.set(2);
  query.set(3);
  expect(asked).toEqual([1]);

  await answer(10);
  expect(asked).toEqual([1, 3]);
  expect(query.latest).toBe(10);
  await answer(30);
  expect(query.latest).toBe(30);
});

test('settles once the latest input is answered', async () => {
  const {query, answer} = harness();
  let settled = false;

  query.set(1);
  query.settled().then(() => {
    settled = true;
  });
  query.set(2);
  await answer(10);
  expect(settled).toBe(false);
  await answer(20);
  expect(settled).toBe(true);
});

test('settles right away with nothing in flight', async () => {
  const {query} = harness();
  let settled = false;

  query.settled().then(() => {
    settled = true;
  });
  await new Promise(resolve => setTimeout(resolve, 0));

  expect(settled).toBe(true);
  expect(query.latest).toBeUndefined();
});

function harness() {
  const asked: number[] = [];
  const pending: Array<(output: number) => void> = [];
  const query = new LatestQuery<number, number>(input => {
    asked.push(input);
    return new Promise(resolve => pending.push(resolve));
  });
  const answer = async (output: number) => {
    pending.shift()!(output);
    await new Promise(resolve => setTimeout(resolve, 0));
  };
  return {query, asked, answer};
}
