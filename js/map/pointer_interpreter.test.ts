import { PointerInterpreter } from './pointer_interpreter';

class Recorder {
  readonly flings: Array<{pageX: number, pageY: number, velocityX: number, velocityY: number}> = [];
  readonly pans: Array<{lastPageX: number, currPageX: number}> = [];
  readonly drags: Array<{kind: 'drag'|'end', pageX: number, moved?: boolean}> = [];
  claimDrags = false;
  clicks = 0;
  contextClicks: Array<{pageX: number, pageY: number}> = [];
  idles = 0;
  zooms = 0;

  dragStart(pageX: number, pageY: number): boolean {
    return this.claimDrags;
  }

  drag(pageX: number, pageY: number): void {
    this.drags.push({kind: 'drag', pageX});
  }

  dragEnd(pageX: number, pageY: number, moved: boolean): void {
    this.drags.push({kind: 'end', pageX, moved});
  }

  click(pageX: number, pageY: number, contextual: boolean): void {
    if (contextual) {
      this.contextClicks.push({pageX, pageY});
    } else {
      this.clicks += 1;
    }
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

function pointer({x = 0, y = 0, id = 1, timeMs = 0, type = 'mouse'}: {
  x?: number,
  y?: number,
  id?: number,
  timeMs?: number,
  type?: string,
}): PointerEvent {
  return {
    button: 0,
    pointerType: type,
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

test('sends a claimed drag to the layer instead of panning', () => {
  const recorder = new Recorder();
  recorder.claimDrags = true;
  const interpreter = new PointerInterpreter(recorder);

  interpreter.pointerDown(pointer({timeMs: 0}));
  const end = drag(interpreter, 0, 0, 1, 3);
  interpreter.pointerUp(pointer({x: end.x, timeMs: end.timeMs}));

  expect(recorder.pans).toEqual([]);
  expect(recorder.flings).toEqual([]);
  expect(recorder.clicks).toBe(0);
  expect(recorder.drags).toEqual([
    {kind: 'drag', pageX: 16},
    {kind: 'drag', pageX: 32},
    {kind: 'drag', pageX: 48},
    {kind: 'end', pageX: 48, moved: true},
  ]);
});

test('clicks after a claimed press that never moved', () => {
  const recorder = new Recorder();
  recorder.claimDrags = true;
  const interpreter = new PointerInterpreter(recorder);

  interpreter.pointerDown(pointer({timeMs: 0}));
  interpreter.pointerMove(pointer({x: 1, timeMs: 16}), /* inCanvas= */ true);
  interpreter.pointerUp(pointer({x: 1, timeMs: 32}));

  expect(recorder.drags[recorder.drags.length - 1]).toEqual({kind: 'end', pageX: 1, moved: false});
  expect(recorder.clicks).toBe(1);
});

test('ends a drag when a second finger lands', () => {
  const recorder = new Recorder();
  recorder.claimDrags = true;
  const interpreter = new PointerInterpreter(recorder);

  interpreter.pointerDown(pointer({timeMs: 0}));
  drag(interpreter, 0, 0, 1, 1);
  interpreter.pointerDown(pointer({x: 100, id: 2, timeMs: 32}));

  expect(recorder.drags[recorder.drags.length - 1]).toEqual({kind: 'end', pageX: 16, moved: true});
});

describe('long press', () => {
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  let nowMs = 0;
  let timers = new Map<number, {atMs: number; fn: () => void}>();

  function advanceTimersByTime(ms: number): void {
    nowMs += ms;
    for (const [id, {atMs, fn}] of [...timers]) {
      if (atMs <= nowMs) {
        timers.delete(id);
        fn();
      }
    }
  }

  beforeEach(() => {
    nowMs = 0;
    timers = new Map();
    let nextId = 1;
    globalThis.setTimeout = ((fn: () => void, ms: number) => {
      const id = nextId++;
      timers.set(id, {atMs: nowMs + ms, fn});
      return id;
    }) as unknown as typeof setTimeout;
    globalThis.clearTimeout = ((id: number) => {
      timers.delete(id);
    }) as unknown as typeof clearTimeout;
  });

  afterEach(() => {
    // A held touch leaves its click swallower armed until the next press
    document.dispatchEvent(new Event('pointerdown'));
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
  });

  test('opens the context menu for a held touch and nothing else', () => {
    const recorder = new Recorder();
    const interpreter = new PointerInterpreter(recorder);

    interpreter.pointerDown(pointer({x: 50, y: 60, type: 'touch'}));
    interpreter.pointerMove(pointer({x: 54, y: 60, timeMs: 100, type: 'touch'}), true);
    advanceTimersByTime(400);
    interpreter.pointerMove(pointer({x: 90, y: 60, timeMs: 500, type: 'touch'}), true);
    interpreter.pointerUp(pointer({x: 90, y: 60, timeMs: 600, type: 'touch'}));

    expect(recorder.contextClicks).toEqual([{pageX: 50, pageY: 60}]);
    expect(recorder.clicks).toBe(0);
    expect(recorder.pans.length).toBe(1);
    expect(recorder.flings).toEqual([]);
  });

  test('swallows the click that follows a held touch, and only that one', () => {
    const recorder = new Recorder();
    const interpreter = new PointerInterpreter(recorder);
    let clicks = 0;
    document.addEventListener('click', () => {
      clicks += 1;
    });

    interpreter.pointerDown(pointer({type: 'touch'}));
    advanceTimersByTime(400);
    interpreter.pointerUp(pointer({timeMs: 500, type: 'touch'}));
    document.dispatchEvent(new Event('click'));
    document.dispatchEvent(new Event('click'));

    expect(clicks).toBe(1);
  });

  test('does not fire once the touch moves past the slop', () => {
    const recorder = new Recorder();
    const interpreter = new PointerInterpreter(recorder);

    interpreter.pointerDown(pointer({type: 'touch'}));
    interpreter.pointerMove(pointer({x: 20, timeMs: 100, type: 'touch'}), true);
    advanceTimersByTime(400);

    expect(recorder.contextClicks).toEqual([]);
  });

  test('does not fire after the touch lifts', () => {
    const recorder = new Recorder();
    const interpreter = new PointerInterpreter(recorder);

    interpreter.pointerDown(pointer({type: 'touch'}));
    interpreter.pointerUp(pointer({timeMs: 100, type: 'touch'}));
    advanceTimersByTime(400);

    expect(recorder.contextClicks).toEqual([]);
    expect(recorder.clicks).toBe(1);
  });

  test('leaves a held mouse to its right button', () => {
    const recorder = new Recorder();
    const interpreter = new PointerInterpreter(recorder);

    interpreter.pointerDown(pointer({}));
    advanceTimersByTime(400);

    expect(recorder.contextClicks).toEqual([]);
  });

  test('ends a claimed drag unmoved before opening the menu', () => {
    const recorder = new Recorder();
    recorder.claimDrags = true;
    const interpreter = new PointerInterpreter(recorder);

    interpreter.pointerDown(pointer({type: 'touch'}));
    interpreter.pointerMove(pointer({x: 5, timeMs: 100, type: 'touch'}), true);
    advanceTimersByTime(400);
    interpreter.pointerMove(pointer({x: 50, timeMs: 500, type: 'touch'}), true);

    expect(recorder.drags).toEqual([
      {kind: 'drag', pageX: 5},
      {kind: 'end', pageX: 0, moved: false},
    ]);
    expect(recorder.contextClicks).toEqual([{pageX: 0, pageY: 0}]);
  });
});
