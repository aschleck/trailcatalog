export type Vec2 = [number, number];
export type Vec4 = [number, number, number, number];

export function checkExists<V>(v: V|null|undefined): V {
  if (v === null || v === undefined) {
    throw new Error(`Argument is ${v}`);
  }
  return v;
}

export class HashMap<K, V> {

  private mapped: Map<unknown, V>;

  constructor(private readonly hashFn: (key: K) => unknown) {
    this.mapped = new Map();
  }

  set(key: K, value: V): void {
    this.mapped.set(this.hashFn(key), value);
  }

  delete(key: K): void {
    this.mapped.delete(this.hashFn(key));
  }

  get(key: K): V|undefined {
    return this.mapped.get(this.hashFn(key));
  }

  has(key: K): boolean {
    return this.mapped.has(this.hashFn(key));
  }
}

export class HashSet<V> {

  private mapped: Set<unknown>;

  constructor(private readonly hashFn: (value: V) => unknown) {
    this.mapped = new Set();
  }

  add(value: V): void {
    this.mapped.add(this.hashFn(value));
  }

  delete(value: V): void {
    this.mapped.delete(this.hashFn(value));
  }

  has(value: V): boolean {
    return this.mapped.has(this.hashFn(value));
  }
}

