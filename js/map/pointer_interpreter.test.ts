import { PointerInterpreter } from './pointer_interpreter';

class Recorder {
  readonly flings: Array<{pageX: number, pageY: number, velocityX: number, velocityY: number}> = [];
  readonly pans: Array<{lastPageX: number, currPageX: number}> = [];
  clicks = 0;
  idles = 0;
  zooms = 0;

  click(pageX: number, pageY: number, contextual: boolean): void {
    this.clicks += 1;
  }

  fling(pageX: number, pageY: number, velocityX: number, velocityY: number): void {
    this.flings.push({pageX, pageY, velocityX, velocityY});
  }

  hover(pageX: number, pageY: number): void {}

  idle(): void {
    this.idles += 1;
  }

  pan(lastPageX: number, lastPageY: number, currPageX: number, currPageY: number): void {
    this.pans.push({lastPageX, currPageX});
  }

  zoom(amount: number, pageX: number, pageY: number): void {
    this.zooms += 1;
  }
}

function pointer(
    {x = 0, y = 0, id = 1, timeMs = 0}: {x?: number, y?: number, id?: number, timeMs?: number}):
    PointerEvent {
  return {
    button: 0,
    pageX: x,
    pageY: y,
    pointerId: id,
    timeStamp: timeMs,
    preventDefault: () => {},
  } as unknown as PointerEvent;
}

// Drags right at `pxPerMs` for `steps` frames of 16ms, returning the time and x it ended at.
function drag(
    interpreter: PointerInterpreter,
    startMs: number,
    startX: number,
    pxPerMs: number,
    steps: number): {timeMs: number, x: number} {
  let timeMs = startMs;
  let x = startX;
  for (let i = 0; i < steps; ++i) {
    timeMs += 16;
    x += 16 * pxPerMs;
    interpreter.pointerMove(pointer({x, timeMs}), /* inCanvas= */ true);
  }
  return {timeMs, x};
}

test('flings a fast release', () => {
  const recorder = new Recorder();
  const interpreter = new PointerInterpreter(recorder);

  interpreter.pointerDown(pointer({timeMs: 0}));
  const end = drag(interpreter, 0, 0, 2, 4);
  interpreter.pointerUp(pointer({x: end.x, timeMs: end.timeMs}));

  expect(recorder.flings.length).toBe(1);
  expect(recorder.flings[0].velocityX).toBeCloseTo(2);
  expect(recorder.flings[0].velocityY).toBeCloseTo(0);
  expect(recorder.idles).toBe(0);
});

test('measures velocity over only the last samples', () => {
  const recorder = new Recorder();
  const interpreter = new PointerInterpreter(recorder);

  interpreter.pointerDown(pointer({timeMs: 0}));
  const fast = drag(interpreter, 0, 0, 2, 20);
  const slow = drag(interpreter, fast.timeMs, fast.x, 0.5, 6);
  interpreter.pointerUp(pointer({x: slow.x, timeMs: slow.timeMs}));

  expect(recorder.flings.length).toBe(1);
  expect(recorder.flings[0].velocityX).toBeCloseTo(0.5);
});

test('does not fling a slow drag', () => {
  const recorder = new Recorder();
  const interpreter = new PointerInterpreter(recorder);

  interpreter.pointerDown(pointer({timeMs: 0}));
  const end = drag(interpreter, 0, 0, 0.06, 6);
  interpreter.pointerUp(pointer({x: end.x, timeMs: end.timeMs}));

  expect(recorder.flings.length).toBe(0);
  expect(recorder.idles).toBe(1);
});

test('does not fling when the pointer paused before lifting', () => {
  const recorder = new Recorder();
  const interpreter = new PointerInterpreter(recorder);

  interpreter.pointerDown(pointer({timeMs: 0}));
  const end = drag(interpreter, 0, 0, 2, 4);
  interpreter.pointerUp(pointer({x: end.x, timeMs: end.timeMs + 200}));

  expect(recorder.flings.length).toBe(0);
  expect(recorder.idles).toBe(1);
});

test('does not fling a click', () => {
  const recorder = new Recorder();
  const interpreter = new PointerInterpreter(recorder);

  interpreter.pointerDown(pointer({x: 50, y: 50, timeMs: 0}));
  interpreter.pointerUp(pointer({x: 50, y: 50, timeMs: 30}));

  expect(recorder.flings.length).toBe(0);
  expect(recorder.clicks).toBe(1);
});

test('drags with one pointer after another is canceled', () => {
  const recorder = new Recorder();
  const interpreter = new PointerInterpreter(recorder);

  interpreter.pointerDown(pointer({id: 1, timeMs: 0}));
  drag(interpreter, 0, 0, 2, 2);
  interpreter.pointerCancel(pointer({id: 1, timeMs: 32}));

  interpreter.pointerDown(pointer({id: 2, x: 100, timeMs: 100}));
  interpreter.pointerMove(pointer({id: 2, x: 110, timeMs: 116}), /* inCanvas= */ true);

  expect(recorder.zooms).toBe(0);
  expect(recorder.pans[recorder.pans.length - 1]).toEqual({lastPageX: 100, currPageX: 110});
});
