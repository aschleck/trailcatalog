export function checkExhaustive(v: never, message?: string): void {
  throw new Error(message ?? 'Value was not exhausted');
}

export function checkExists<V>(v: V|null|undefined): V {
  if (v === null || v === undefined) {
    throw new Error(`Argument is ${v}`);
  }
  return v;
}

export function exists<T>(v: T|null|undefined): v is T {
  if (v === null || v === undefined) {
    return false;
  } else {
    return true;
  }
}
