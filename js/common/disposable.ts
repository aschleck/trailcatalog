type EventKeys = keyof DocumentEventMap|keyof HTMLElementEventMap|keyof WindowEventMap;

type DocumentTarget<K> = K extends keyof DocumentEventMap ? Document : never;
type DocumentListener<K> = K extends keyof DocumentEventMap ? (ev: DocumentEventMap[K]) => any : never;
type HTMLElementTarget<K> = K extends keyof HTMLElementEventMap ? HTMLElement : never;
type HTMLElementListener<K> = K extends keyof HTMLElementEventMap ? (ev: HTMLElementEventMap[K]) => any : never;
type SVGElementTarget<K> = K extends keyof SVGElementEventMap ? SVGElement : never;
type SVGElementListener<K> = K extends keyof SVGElementEventMap ? (ev: SVGElementEventMap[K]) => any : never;
type WindowTarget<K> = K extends keyof WindowEventMap ? Window : never;
type WindowListener<K> = K extends keyof WindowEventMap ? (ev: WindowEventMap[K]) => any : never;

export class Disposable {

  private _isDisposed: boolean;
  private disposers: Array<() => void>;

  constructor() {
    this._isDisposed = false;
    this.disposers = [];
  }

  dispose(): void {
    this._isDisposed = true;
    for (const disposer of this.disposers) {
      disposer();
    }
    this.disposers.length = 0;
  }

  get isDisposed(): boolean {
    return this._isDisposed;
  }

  registerDisposable(disposable: Disposable): void {
    this.disposers.push(() => {
      disposable.dispose();
    });
  }

  registerDisposer(fn: () => void): void {
    this.disposers.push(fn);
  }

  registerListener<K extends EventKeys>(
      target: DocumentTarget<K>|HTMLElementTarget<K>|SVGElementTarget<K>|WindowTarget<K>,
      type: K,
      listener: DocumentListener<K>|HTMLElementListener<K>|SVGElementListener<K>|WindowListener<K>,
      options?: boolean|AddEventListenerOptions): void {
    target.addEventListener(type, listener as any, options);
    this.disposers.push(() => {
      target.removeEventListener(type, listener as any);
    });
  }
}

