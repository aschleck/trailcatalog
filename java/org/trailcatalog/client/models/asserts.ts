export function checkExhaustive(v: never, message: string): void {
  throw new Error(message);
}

export function checkExists<V>(v: V|null|undefined): V {
  if (v === null || v === undefined) {
    throw new Error(`Argument is ${v}`);
  }
  return v;
}

