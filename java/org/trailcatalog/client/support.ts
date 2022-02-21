import { Long } from 'java/org/trailcatalog/s2';

export type Vec2 = [number, number];
export type Vec4 = [number, number, number, number];

export interface PixelRect {
  low: Vec2;
  high: Vec2;
};

export function checkExists<V>(v: V|null|undefined): V {
  if (v === null || v === undefined) {
    throw new Error(`Argument is ${v}`);
  }
  return v;
}

const reinterpretLongBuffer = new ArrayBuffer(8);
export function reinterpretLong(v: Long): number {
  const floats = new Int32Array(reinterpretLongBuffer);
  floats[0] = v.getHighBits();
  floats[1] = v.getLowBits();
  return new Float64Array(reinterpretLongBuffer)[0];
}

export class HashMap<K, V> {

  private keys: Map<unknown, K>;
  private mapped: Map<unknown, V>;

  constructor(private readonly hashFn: (key: K) => unknown) {
    this.keys = new Map();
    this.mapped = new Map();
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
