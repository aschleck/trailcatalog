export class DefaultMap<K, V> {

  readonly map: Map<K, V>;

  constructor(private readonly factory: (key: K) => V, elements?: Array<[K, V]>) {
    this.map = new Map(elements);
  }

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }

  set(key: K, value: V): void {
    this.map.set(key, value);
  }

  delete(key: K): void {
    this.map.delete(key);
  }

  get(key: K): V {
    if (!this.map.has(key)) {
      this.map.set(key, this.factory(key));
    }
    return this.map.get(key) as V; // we can't use checkExists because V may include undefined
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  keys(): IterableIterator<K> {
    return this.map.keys();
  }

  values(): IterableIterator<V> {
    return this.map.values();
  }

  [Symbol.iterator](): Iterator<[K, V]> {
    return this.map[Symbol.iterator]();
  }
}

export class HashMap<K, V> {

  private readonly _keys: Map<unknown, K>;
  private readonly mapped: Map<unknown, V>;

  constructor(private readonly hashFn: (key: K) => unknown) {
    this._keys = new Map();
    this.mapped = new Map();
  }

  get size(): number {
    return this._keys.size;
  }

  clear(): void {
    this._keys.clear();
    this.mapped.clear();
  }

  set(key: K, value: V): void {
    const hash = this.hashFn(key);
    this._keys.set(hash, key);
    this.mapped.set(hash, value);
  }

  delete(key: K): void {
    const hash = this.hashFn(key);
    this._keys.delete(hash);
    this.mapped.delete(hash);
  }

  get(key: K): V|undefined {
    return this.mapped.get(this.hashFn(key));
  }

  has(key: K): boolean {
    return this.mapped.has(this.hashFn(key));
  }

  keys(): IterableIterator<K> {
    return this._keys.values();
  }

  values(): IterableIterator<V> {
    return this.mapped.values();
  }

  [Symbol.iterator](): Iterator<[K, V]> {
    const keyIterator = this._keys[Symbol.iterator]();
    return {
      next: () => {
        const {value, done} = keyIterator.next();
        if (done) {
          return {
            value: undefined,
            done,
          };
        } else {
          const [hash, key] = value;
          return {
            // We need to cast to V because the type from get is V|undefined, and we can't
            // checkExists because V itself might include undefined.
            value: [key, this.mapped.get(hash) as V],
            done: false,
          };
        }
      },
    };
  }
}

export class HashSet<V> {

  private readonly mapped: Set<unknown>;
  private readonly values: Map<unknown, V>;

  constructor(private readonly hashFn: (value: V) => unknown, elements?: V[]) {
    this.mapped = new Set();
    this.values = new Map();

    for (const element of elements ?? []) {
      this.add(element);
    }
  }

  get size(): number {
    return this.mapped.size;
  }

  add(value: V): void {
    const hash = this.hashFn(value);
    this.mapped.add(hash);
    this.values.set(hash, value)
  }

  clear(): void {
    this.mapped.clear();
    this.values.clear();
  }

  delete(value: V): void {
    const hash = this.hashFn(value);
    this.mapped.delete(hash);
    this.values.delete(hash);
  }

  has(value: V): boolean {
    return this.mapped.has(this.hashFn(value));
  }

  [Symbol.iterator](): Iterator<V> {
    return this.values.values();
  }
}

export class IdentitySetMultiMap<K, V> {

  private map: Map<K, V[]>;

  constructor() {
    this.map = new Map();
  }

  clear(): void {
    this.map.clear();
  }

  put(key: K, value: V): void {
    let values = this.map.get(key);
    if (values) {
      for (const element of values) {
        if (value === element) {
          return;
        }
      }
      values.push(value);
    } else {
      values = [value];
      this.map.set(key, values);
    }
  }

  delete(key: K, value: V): void {
    const values = this.map.get(key);
    if (!values) {
      return;
    }

    if (values.length === 1) {
      if (value === values[0]) {
        this.map.delete(key);
      }
    } else {
      for (let i = 0; i < values.length; ++i) {
        if (value === values[i]) {
          values.splice(i, 1);
          break;
        }
      }
    }
  }

  get(key: K): V[]|undefined {
    return this.map.get(key);
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  [Symbol.iterator](): Iterator<[K, V[]]> {
    return this.map[Symbol.iterator]();
  }
}

