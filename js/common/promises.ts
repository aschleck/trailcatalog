import { checkArgument } from 'js/common/asserts';

export function waitSettled(): Promise<void> {
  return waitTicks(640); // 640 ticks ought to be enough for anybody...
}

export function waitTicks(count: number): Promise<void> {
  checkArgument(count >= 1);
  let promise = Promise.resolve();
  for (let i = 1; i < count; ++i) {
    promise = promise.then(() => {});
  }
  return promise;
}
