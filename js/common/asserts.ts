export function checkArgument(v: any, message?: string): void {
  if (!v) {
    throw new Error(message ?? 'Argument was false-y');
  }
}

export function checkExhaustive(v: never, message?: string): void {
  throw new Error(message ?? 'Value was not exhausted');
}

export function checkExists<V>(v: V|null|undefined, message?: string): V {
  if (v === null || v === undefined) {
    throw new Error(message ?? `Argument is ${v}`);
  }
  return v;
}

export function checkState(v: any, message?: string): void {
  if (!v) {
    throw new Error(message ?? 'Unexpected state was false-y');
  }
}

export function exists<T>(v: T|null|undefined): v is T {
  if (v === null || v === undefined) {
    return false;
  } else {
    return true;
  }
}
