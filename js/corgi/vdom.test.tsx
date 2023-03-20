import * as corgi from 'js/corgi';

afterEach(() => {
  document.body.innerHTML = '';
});

test('adds element to dom', () => {
  corgi.appendElement(document.body, <span>Hello</span>);
  expect(document.body.innerHTML).toBe('<span>Hello</span>');
});

test('adds function to dom', () => {
  corgi.appendElement(document.body, <Tree />);
  expect(document.body.innerHTML).toBe('<div><span>first</span><div>second</div></div>');
});

test('adds primitive function to dom', () => {
  corgi.appendElement(document.body, <SimpleString />);
  expect(document.body.innerHTML).toBe('hello');
});

test('adds number to dom', () => {
  corgi.appendElement(document.body, 2.718);
  expect(document.body.innerHTML).toBe('2.718');
});

test('adds text to dom', () => {
  corgi.appendElement(document.body, 'hello world');
  expect(document.body.innerHTML).toBe('hello world');
});

test('handles class attributes', () => {
  corgi.appendElement(document.body, <span className="moo">Hello</span>);
  expect(document.body.innerHTML).toBe('<span class="moo">Hello</span>');
});

test('merges fragments', () => {
  corgi.appendElement(
      document.body,
      <div>
        <>
          <span>Hello</span>
        </>
        <>
          <span>Goodbye</span>
        </>
      </div>);
  expect(document.body.innerHTML).toBe('<div><span>Hello</span><span>Goodbye</span></div>');
});

test('skips fragment', () => {
  corgi.appendElement(document.body, <div><><span>Hello</span></></div>);
  expect(document.body.innerHTML).toBe('<div><span>Hello</span></div>');
});

test('patches dom', (done: jest.DoneCallback) => {
  const verifier = () => {
    expect(document.body.innerHTML).toBe('<div>Pushed: true</div>');
    done();
  };
  corgi.appendElement(document.body, <Flipper done={verifier} />);
});

test('patches evil', (done: jest.DoneCallback) => {
  const verifier = () => {
    try {
      expect(document.body.innerHTML).toBe('FirstSecondThird');
      done();
    } catch (error: unknown) {
      done(error);
    }
  };
  corgi.appendElement(document.body, <EvilCounter done={verifier} />);
});

test('patches fragment dom in', (done: jest.DoneCallback) => {
  const verifier = () => {
    try {
      expect(document.body.innerHTML)
          .toBe('<div><span>First</span><div>second</div><span>third</span></div>');
      done();
    } catch (error: unknown) {
      done(error);
    }
  };
  corgi.appendElement(document.body, <FragmentFlipper done={verifier} initial={false} />);
});

test('patches fragment dom out', (done: jest.DoneCallback) => {
  const verifier = () => {
    expect(document.body.innerHTML)
        .toBe('<div><span>First</span><div>third</div></div>');
    done();
  };
  corgi.appendElement(document.body, <FragmentFlipper done={verifier} initial={true} />);
});

test('patches tree dom', (done: jest.DoneCallback) => {
  const verifier = () => {
    expect(document.body.innerHTML)
        .toBe('<div><span>Good</span><div><span>job</span></div><span>you pressed it</span></div>');
    done();
  };
  corgi.appendElement(document.body, <TreeFlipper done={verifier} />);
});

test('hydrates dom', (done: jest.DoneCallback) => {
  document.body.innerHTML = '<div>Pushed: false</div>';
  const verifier = () => {
    expect(document.body.innerHTML).toBe('<div>Pushed: true</div>');
    done();
  };
  corgi.hydrateElement(document.body, <Flipper done={verifier} />);
});

test('hydrates evil', (done: jest.DoneCallback) => {
  const verifier = () => {
    try {
      expect(document.body.innerHTML).toBe('FirstSecondThird');
      done();
    } catch (error: unknown) {
      done(error);
    }
  };
  corgi.hydrateElement(document.body, <EvilCounter done={verifier} />);
});

function SimpleString() {
  return 'hello';
}

function Tree() {
  return (
    <div>
      <span>first</span>
      <div>second</div>
    </div>
  );
}

interface FlipperState {
  pushed: boolean;
}

function Flipper(
    {done}: {done: () => void},
    state: FlipperState|undefined,
    updateState: (newState: FlipperState) => void) {
  if (!state) {
    state = {
      pushed: false,
    }
  }

  if (!state.pushed) {
    Promise.resolve().then(() => {
      updateState({pushed: true});
      done();
    });
  }

  return <div>Pushed: {state.pushed}</div>;
}

function EvilCounter(
    {done}: {done: () => void},
    state: {count: number}|undefined,
    updateState: (newState: {count: number}) => void) {
  if (!state) {
    state = {
      count: 0,
    }
  }

  if (state.count === 0) {
    Promise.resolve().then(() => {
      updateState({count: 1});
    });
  } else if (state.count === 1) {
    Promise.resolve().then(() => {
      updateState({count: 2});
    });
  } else if (state.count === 2) {
    Promise.resolve().then(() => {
      updateState({count: 3});
      done();
    });
  }

  if (state.count === 0) {
    return (
      <>
        <></>
        <></>
        <></>
      </>
    );
  } else if (state.count === 1) {
    return (
      <>
        <></>
        <></>
        <>Third</>
      </>
    );
  } else if (state.count === 2) {
    return (
      <>
        <>First</>
        <></>
        <>Third</>
      </>
    );
  } else if (state.count === 3) {
    return (
      <>
        <>First</>
        <>Second</>
        <>Third</>
      </>
    );
  } else {
    return 'what';
  }
}

function FragmentFlipper(
    {done, initial}: {done: () => void, initial: boolean},
    state: FlipperState|undefined,
    updateState: (newState: FlipperState) => void) {
  if (!state) {
    state = {
      pushed: initial,
    }
  }

  const activeState = state;

  if (state.pushed === initial) {
    Promise.resolve().then(() => {
      updateState({pushed: !activeState.pushed});
      done();
    });
  }

  if (state.pushed) {
    return (
      <div>
        <span>First</span>
        <div>second</div>
        <span>third</span>
      </div>
    );
  } else {
    return (
      <div>
        <span>First</span>
        <></>
        <div>third</div>
      </div>
    );
  }
}

function TreeFlipper(
    {done}: {done: () => void},
    state: FlipperState|undefined,
    updateState: (newState: FlipperState) => void) {
  if (!state) {
    state = {
      pushed: false,
    }
  }

  if (!state.pushed) {
    Promise.resolve().then(() => {
      updateState({pushed: true});
      done();
    });
  }

  if (state.pushed) {
    return (
      <div>
        <span>Good</span>
        <div><span>job</span></div>
        <span>you pressed it</span>
      </div>
    );
  } else {
    return (
      <div>
        <span>Please</span>
        <div><span>press</span></div>
        <div>the button</div>
      </div>
    );
  }
}
