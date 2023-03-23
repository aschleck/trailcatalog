import { checkArgument } from 'js/common/asserts';

export function waitTicks(count: number): Promise<void> {
  checkArgument(count >= 1);
  let promise = Promise.resolve();
  for (let i = 1; i < count; ++i) {
    promise = promise.then(() => {});
  }
  return promise;
}
