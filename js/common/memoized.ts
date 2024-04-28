export class Memoized<T> {

  private _value: T|undefined;

  constructor(private readonly fn: () => T) {}

  get value(): T {
    return this._value ?? (this._value = this.fn());
  }

  set value(v: T) {
    this._value = v;
  }
}

class FakeMemoized<T> {

  constructor(private readonly fn: () => T) {}

  get value(): T {
    return this.fn();
  }
}

export function maybeMemoized<T>(fn: () => T): {value: T} {
  if (globalThis.window && !('SERVER_SIDE_RENDER' in globalThis.window)) {
    return new Memoized<T>(fn);
  } else {
    return new FakeMemoized<T>(fn);
  }
}
