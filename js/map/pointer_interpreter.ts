interface PointerListener {
  click(pageX: number, pageY: number, contextual: boolean): void;
  hover(pageX: number, pageY: number): void;
  idle(): void;
  pan(dx: number, dy: number): void;
  zoom(amount: number, pageX: number, pageY: number): void;
}

// Firefox has a bug where after the event handler runs offsetX/offsetY are cleared, so we clone
// events. What a mess.
interface SimplePointerEvent {
  pageX: number;
  pageY: number;
  pointerId: number;
}

export class PointerInterpreter {

  private readonly pointers: Map<number, SimplePointerEvent>;
  private maybeClickStart: SimplePointerEvent|undefined;

  // If the user is panning or zooming, we want to trigger an idle call when they stop.
  private needIdle: boolean;

  constructor(private readonly listener: PointerListener) {
    this.pointers = new Map();
    this.maybeClickStart = undefined;
    this.needIdle = false;
  }

  pointerDown(e: PointerEvent): void {
    e.preventDefault();
    this.pointers.set(e.pointerId, {
      pageX: e.pageX,
      pageY: e.pageY,
      pointerId: e.pointerId,
    });

    if (this.pointers.size === 1) {
      this.maybeClickStart = {
        pageX: e.pageX,
        pageY: e.pageY,
        pointerId: e.pointerId,
      };
    } else {
      this.maybeClickStart = undefined;
    }
  }

  pointerMove(e: PointerEvent, inCanvas: boolean): void {
    if (!this.pointers.has(e.pointerId)) {
      if (inCanvas) {
        this.listener.hover(e.pageX, e.pageY);
      }
      return;
    }

    e.preventDefault();
    this.needIdle = true;

    if (this.pointers.size === 1) {
      const [last] = this.pointers.values();
      this.listener.pan(last.pageX - e.pageX, -(last.pageY - e.pageY));

      if (this.maybeClickStart) {
        const d2 = distance2(this.maybeClickStart, e);
        if (d2 > 3 * 3) {
          this.maybeClickStart = undefined;
        }
      }
    } else if (this.pointers.size === 2) {
      const [a, b] = this.pointers.values();
      let pivot, handle;
      if (a.pointerId === e.pointerId) {
        pivot = b;
        handle = a;
      } else {
        pivot = a;
        handle = b;
      }

      const was = distance2(pivot, handle);
      const is = distance2(pivot, e);
      this.listener.zoom(
          Math.sqrt(is / was),
          (pivot.pageX + e.pageX) / 2,
          (pivot.pageY + e.pageY) / 2);
    }

    this.pointers.set(e.pointerId, {
      pageX: e.pageX,
      pageY: e.pageY,
      pointerId: e.pointerId,
    });
  }

  pointerUp(e: PointerEvent): void {
    if (!this.pointers.has(e.pointerId)) {
      return;
    }

    e.preventDefault();
    this.pointers.delete(e.pointerId);

    if (this.pointers.size === 0) {
      if (this.needIdle) {
        this.listener.idle();
        this.needIdle = false;
      }

      if (this.maybeClickStart) {
        this.listener.click(this.maybeClickStart.pageX, this.maybeClickStart.pageY, e.button === 2);
        this.maybeClickStart = undefined;
      }
    }
  }
}

function distance2(a: SimplePointerEvent, b: SimplePointerEvent): number {
  const x = a.pageX - b.pageX;
  const y = a.pageY - b.pageY;
  return x * x + y * y;
}

