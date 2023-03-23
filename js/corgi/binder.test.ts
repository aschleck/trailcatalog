import { waitSettled, waitTicks } from 'js/common/promises';
import * as corgi from 'js/corgi';
import { Binder } from 'js/corgi/binder';
import { Controller, Response } from 'js/corgi/controller';
import { EmptyDeps } from 'js/corgi/deps';

afterEach(() => {
  document.body.innerHTML = '';
});

test('ignores non-js, non-unbound', () => {
  const div = document.createElement('div');
  document.body.append(div);
  new Binder().createdElement(div, {});
  expect(div.getAttribute('data-js')).toBeNull();
});

test('lazily sets up controller', async () => {
  const div = document.createElement('div');
  document.body.append(div);
  new Binder().createdElement(div, {
    js: corgi.bind({
      controller: NoisyController,
      state: [{}, (newState: {}) => {}],
    }),
  });

  await waitTicks(1);
  expect(div.getAttribute('data-js')).toBe('');
});

test('handles events', async () => {
  const div = document.createElement('div');
  document.body.append(div);
  const state = {
    created: false,
    clicked: false,
  };
  new Binder().createdElement(div, {
    js: corgi.bind({
      controller: NoisyController,
      args: {
        initCallback: () => {state.created = true;},
        clickCallback: () => {state.clicked = true;},
      },
      events: {'click': 'clicked'},
      state: [{}, (newState: {}) => {}],
    }),
  });

  await waitSettled();
  expect(state.created).toBe(false);
  expect(state.clicked).toBe(false);

  div.click();
  await waitSettled();
  expect(state.created).toBe(true);
  expect(state.clicked).toBe(true);
});

test('sets up controller ref', async () => {
  const div = document.createElement('div');
  document.body.append(div);
  new Binder().createdElement(div, {
    js: corgi.bind({
      controller: NoisyController,
      ref: 'cow',
      state: [{}, (newState: {}) => {}],
    }),
  });

  await waitTicks(1);
  expect(div.getAttribute('data-js-ref')).toBe('cow');
});

test('cleans up controller and ref', async () => {
  const div = document.createElement('div');
  document.body.append(div);
  const binder = new Binder();

  const oldProps = {
    js: corgi.bind({
      controller: NoisyController,
      ref: 'cow',
      state: [{}, (newState: {}) => {}],
    }),
  };
  binder.createdElement(div, oldProps);

  await waitTicks(1);
  expect(div.getAttribute('data-js')).toBe('');
  expect(div.getAttribute('data-js-ref')).toBe('cow');

  binder.patchedElement(div, oldProps, {});
  await waitTicks(1);
  expect(div.getAttribute('data-js')).toBeNull();
  expect(div.getAttribute('data-js-ref')).toBeNull();
});

test('wakes up controller', async () => {
  const div = document.createElement('div');
  document.body.append(div);

  const state = {created: false};
  new Binder().createdElement(div, {
    js: corgi.bind({
      controller: NoisyController,
      args: {initCallback: () => {state.created = true;}},
      events: {render: 'wakeup'},
      state: [{}, (newState: {}) => {}],
    }),
  });

  await waitTicks(2);
  expect(state.created).toBe(true);
});

test('different args reuse controller', async () => {
  const div = document.createElement('div');
  document.body.append(div);
  const binder = new Binder();

  const originalProps = {
    js: corgi.bind({
      controller: NoisyController,
      events: {render: 'wakeup'},
      state: [{}, (newState: {}) => {}],
    }),
  };
  binder.createdElement(div, originalProps);
  await waitSettled();

  const state = {
    created: false,
    updatedArgs: false,
  };
  const newProps = {
    js: corgi.bind({
      controller: NoisyController,
      args: {
        initCallback: () => {state.created = true;},
        updateArgsCallback: () => {state.updatedArgs = true;},
      },
      events: {render: 'wakeup'},
      state: [{}, (newState: {}) => {}],
    }),
  };
  binder.patchedElement(div, originalProps, newProps);
  await waitSettled();

  expect(state.created).toBe(false);
  expect(state.updatedArgs).toBe(true);
});

test('different keys recreate controller', async () => {
  const div = document.createElement('div');
  document.body.append(div);
  const binder = new Binder();

  const originalProps = {
    js: corgi.bind({
      controller: NoisyController,
      key: 'cat',
      events: {render: 'wakeup'},
      state: [{}, (newState: {}) => {}],
    }),
  };
  binder.createdElement(div, originalProps);
  await waitSettled();

  const state = {
    created: false,
    updatedArgs: false,
  };
  const newProps = {
    js: corgi.bind({
      controller: NoisyController,
      key: 'dog',
      args: {
        initCallback: () => {state.created = true;},
        updateArgsCallback: () => {state.updatedArgs = true;},
      },
      events: {render: 'wakeup'},
      state: [{}, (newState: {}) => {}],
    }),
  };
  binder.patchedElement(div, originalProps, newProps);
  await waitSettled();

  expect(state.created).toBe(true);
  expect(state.updatedArgs).toBe(false);
});

test('unbound events find controller', async () => {
  const div = document.createElement('div');
  document.body.append(div);
  const a = document.createElement('a');
  div.append(a);
  const binder = new Binder();

  const state = {clicked: false};
  binder.createdElement(div, {
    js: corgi.bind({
      controller: NoisyController,
      args: {clickCallback: () => {state.clicked = true;}},
      state: [{}, (newState: {}) => {}],
    }),
  });
  binder.createdElement(a, {
    unboundEvents: {click: 'clicked'},
  });
  await waitSettled();

  a.click();
  await waitSettled();

  expect(state.clicked).toBe(true);
});

test('unbound events find new controller', async () => {
  const div = document.createElement('div');
  document.body.append(div);
  const a = document.createElement('a');
  div.append(a);
  const binder = new Binder();

  const oldProps = {
    js: corgi.bind({
      controller: NoisyController,
      key: 'cat',
      state: [{}, (newState: {}) => {}],
    }),
  };
  binder.createdElement(div, oldProps);
  binder.createdElement(a, {
    unboundEvents: {click: 'clicked'},
  });
  await waitSettled();

  a.click();
  await waitSettled();

  const state = {
    created: false,
    clicked: false,
  };
  const newProps = {
    js: corgi.bind({
      controller: NoisyController,
      key: 'dog',
      args: {
        initCallback: () => {state.created = true;},
        clickCallback: () => {state.clicked = true;},
      },
      state: [{}, (newState: {}) => {}],
    }),
  };
  binder.patchedElement(div, oldProps, newProps);
  await waitSettled();

  a.click();
  await waitSettled();

  expect(state.created).toBe(true);
  expect(state.clicked).toBe(true);
});

test('unbound events find new controller', async () => {
  const div = document.createElement('div');
  document.body.append(div);
  const a = document.createElement('a');
  div.append(a);
  const binder = new Binder();

  const state = {clicked: false};
  binder.createdElement(div, {
    js: corgi.bind({
      controller: NoisyController,
      args: {clickCallback: () => {state.clicked = true;}},
      state: [{}, (newState: {}) => {}],
    }),
  });
  const oldProps = {
    unboundEvents: {click: 'clicked'},
  };
  binder.createdElement(a, oldProps);
  await waitSettled();

  const newProps = {
    unboundEvents: {},
  };
  binder.patchedElement(a, oldProps, newProps);
  await waitSettled();

  a.click();
  await waitSettled();
  expect(state.clicked).toBe(false);
});

interface NoisyArgs {
  initCallback?: () => void;
  clickCallback?: () => void;
  updateArgsCallback?: () => void;
}

class NoisyController extends Controller<NoisyArgs, EmptyDeps, HTMLElement, {}> {

  private args: NoisyArgs;

  constructor(response: Response<NoisyController>) {
    super(response);
    const args = response.args;
    this.args = args;
    if (args.initCallback) {
      args.initCallback();
    }
  }

  clicked(): void {
    if (this.args.clickCallback) {
      this.args.clickCallback();
    }
  }

  updateArgs(newArgs: NoisyArgs) {
    this.args = newArgs;
    if (newArgs.updateArgsCallback) {
      newArgs.updateArgsCallback();
    }
  }
}

