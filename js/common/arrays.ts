export function compare<E>(a: readonly E[], b: readonly E[]): number {
  const common = Math.min(a.length, b.length);
  for (let i = 0; i < common; ++i) {
    if (a[i] !== b[i]) {
      return a[i] < b[i] ? -1 : 1;
    }
  }

  if (a.length === b.length) {
    return 0;
  } else if (a.length < b.length) {
    return -1;
  } else {
    return 1;
  }
}

export function equals<E>(a: readonly E[], b: readonly E[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; ++i) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

export function pushInto<E>(destination: E[], source: E[]): void {
  // When you use destination.push(...source) there's some horrific stuff happening on the stack.
  // This avoids that.
  for (let i = 0; i < source.length; ++i) {
    destination.push(source[i]);
  }
}
