import { Vec2 } from './common/types';

interface PointerListener {
  click(pageX: number, pageY: number, contextual: boolean): void;
  // Asked on every single-pointer press. Claiming it sends the moves that follow to drag instead of
  // panning.
  dragStart(pageX: number, pageY: number): boolean;
  drag(pageX: number, pageY: number): void;
  // Moved is false for a press that never left the click radius, which still clicks.
  dragEnd(pageX: number, pageY: number, moved: boolean): void;
  fling(pageX: number, pageY: number, velocityX: number, velocityY: number): void;
  hover(pageX: number, pageY: number): void;
  idle(): void;
  pan(lastPageX: number, lastPageY: number, currPageX: number, currPageY: number): void;
  zoom(amount: number, pageX: number, pageY: number): void;
}

// Firefox has a bug where after the event handler runs offsetX/offsetY are cleared, so we clone
// events. What a mess.
interface SimplePointerEvent {
  pageX: number;
  pageY: number;
  pointerId: number;
}

interface Sample {
  pageX: number;
  pageY: number;
  timeMs: number;
}

// A single pair of moves is too noisy to aim a fling with, especially on touch screens where
// consecutive samples can land on the same pixel, so we average over a window. 100ms is 6 samples
// at 60hz and short enough that a curve at the end of the drag decides the direction.
const FLING_WINDOW_MS = 100;
// Lifting after holding still means the user placed the map instead of throwing it.
const FLING_STALE_MS = 50;
// At 150 px/s the glide is under 40px with map_controller.ts#FLING_DECAY_MS, which isn't worth
// animating.
const FLING_MIN_SPEED = 0.15; // in px/ms

export class PointerInterpreter {

  private readonly pointers: Map<number, SimplePointerEvent>;
  private maybeClickStart: SimplePointerEvent|undefined;
  // Whether a layer claimed the press under way
  private dragging: boolean;
  // Recent single-pointer positions inside FLING_WINDOW_MS, oldest first.
  private readonly samples: Sample[];

  // If the user is panning or zooming, we want to trigger an idle call when they stop.
  private needIdle: boolean;

  constructor(private readonly listener: PointerListener) {
    this.pointers = new Map();
    this.maybeClickStart = undefined;
    this.dragging = false;
    this.samples = [];
    this.needIdle = false;
  }

  pointerDown(e: PointerEvent): void {
    e.preventDefault();
    this.pointers.set(e.pointerId, {
      pageX: e.pageX,
      pageY: e.pageY,
      pointerId: e.pointerId,
    });

    this.samples.length = 0;
    if (this.pointers.size === 1) {
      // A flick can be over in one move, so the press is the only sample we have to measure it
      // against.
      this.sample(e);

      this.maybeClickStart = {
        pageX: e.pageX,
        pageY: e.pageY,
        pointerId: e.pointerId,
      };
      this.dragging = e.button === 0 && this.listener.dragStart(e.pageX, e.pageY);
    } else {
      this.maybeClickStart = undefined;
      // A second finger turns a drag into a pinch, so the drag ends where the first finger was.
      const [first] = this.pointers.values();
      this.endDrag(first.pageX, first.pageY);
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

    if (this.dragging) {
      this.listener.drag(e.pageX, e.pageY);
      if (this.maybeClickStart && distance2(this.maybeClickStart, e) > 3 * 3) {
        this.maybeClickStart = undefined;
      }
      this.pointers.set(e.pointerId, {
        pageX: e.pageX,
        pageY: e.pageY,
        pointerId: e.pointerId,
      });
      return;
    }

    this.needIdle = true;

    if (this.pointers.size === 1) {
      const [last] = this.pointers.values();
      this.listener.pan(last.pageX, last.pageY, e.pageX, e.pageY);
      this.sample(e);

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
      this.endDrag(e.pageX, e.pageY);
      if (this.needIdle) {
        this.needIdle = false;
        const velocity = this.flingVelocity(e.timeStamp);
        if (velocity) {
          // The listener idles when the fling settles.
          this.listener.fling(e.pageX, e.pageY, velocity[0], velocity[1]);
        } else {
          this.listener.idle();
        }
      }

      if (this.maybeClickStart) {
        this.listener.click(this.maybeClickStart.pageX, this.maybeClickStart.pageY, e.button === 2);
        this.maybeClickStart = undefined;
      }
    }

    this.samples.length = 0;
  }

  // The browser takes gestures away from us on mobile, so without this a canceled touch stays in
  // the map forever and the next one-finger drag looks like the second half of a pinch.
  pointerCancel(e: PointerEvent): void {
    if (!this.pointers.has(e.pointerId)) {
      return;
    }

    this.pointers.delete(e.pointerId);
    this.maybeClickStart = undefined;
    this.samples.length = 0;
    this.endDrag(e.pageX, e.pageY);

    if (this.pointers.size === 0 && this.needIdle) {
      this.needIdle = false;
      this.listener.idle();
    }
  }

  private endDrag(pageX: number, pageY: number): void {
    if (!this.dragging) {
      return;
    }

    this.dragging = false;
    this.listener.dragEnd(pageX, pageY, /* moved= */ !this.maybeClickStart);
  }

  private sample(e: PointerEvent): void {
    while (this.samples.length > 0 && e.timeStamp - this.samples[0].timeMs > FLING_WINDOW_MS) {
      this.samples.shift();
    }

    this.samples.push({
      pageX: e.pageX,
      pageY: e.pageY,
      timeMs: e.timeStamp,
    });
  }

  private flingVelocity(upTimeMs: number): Vec2|undefined {
    const oldest = this.samples[0];
    const newest = this.samples[this.samples.length - 1];
    if (!newest || upTimeMs - newest.timeMs > FLING_STALE_MS) {
      return undefined;
    }

    const dt = newest.timeMs - oldest.timeMs;
    if (dt <= 0) {
      return undefined;
    }

    const vX = (newest.pageX - oldest.pageX) / dt;
    const vY = (newest.pageY - oldest.pageY) / dt;
    if (vX * vX + vY * vY < FLING_MIN_SPEED * FLING_MIN_SPEED) {
      return undefined;
    }

    return [vX, vY];
  }
}

function distance2(a: SimplePointerEvent, b: SimplePointerEvent): number {
  const x = a.pageX - b.pageX;
  const y = a.pageY - b.pageY;
  return x * x + y * y;
}

