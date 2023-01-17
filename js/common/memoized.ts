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

