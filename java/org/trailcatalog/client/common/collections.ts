import { checkExists } from 'js/common/asserts';

export class HashMap<K, V> {

  private keys: Map<unknown, K>;
  private mapped: Map<unknown, V>;

  constructor(private readonly hashFn: (key: K) => unknown) {
    this.keys = new Map();
    this.mapped = new Map();
  }

  clear(): void {
    this.keys.clear();
    this.mapped.clear();
  }

  set(key: K, value: V): void {
    const hash = this.hashFn(key);
    this.keys.set(hash, key);
    this.mapped.set(hash, value);
  }

  delete(key: K): void {
    const hash = this.hashFn(key);
    this.keys.delete(hash);
    this.mapped.delete(hash);
  }

  get(key: K): V|undefined {
    return this.mapped.get(this.hashFn(key));
  }

  has(key: K): boolean {
    return this.mapped.has(this.hashFn(key));
  }

  [Symbol.iterator](): Iterator<[K, V]> {
    const keyIterator = this.keys[Symbol.iterator]();
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
            value: [key, checkExists(this.mapped.get(hash))],
            done: false,
          };
        }
      },
    };
  }
}

export class HashSet<V> {

  private mapped: Set<unknown>;
  private values: Map<unknown, V>;

  constructor(private readonly hashFn: (value: V) => unknown) {
    this.mapped = new Set();
    this.values = new Map();
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

