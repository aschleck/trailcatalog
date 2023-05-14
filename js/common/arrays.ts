export function pushInto<E>(destination: E[], source: E[]): void {
  for (let i = 0; i < source.length; ++i) {
    destination.push(source[i]);
  }
}
