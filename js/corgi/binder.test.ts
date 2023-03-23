import { waitTicks } from 'js/common/promises';
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
  await waitTicks(10);

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
  await waitTicks(10);

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
  await waitTicks(10);

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
  await waitTicks(10);

  expect(state.created).toBe(true);
  expect(state.updatedArgs).toBe(false);
});

interface NoisyArgs {
  initCallback?: () => void;
  updateArgsCallback?: () => void;
}

class NoisyController extends Controller<NoisyArgs, EmptyDeps, HTMLElement, {}> {

  constructor(response: Response<NoisyController>) {
    super(response);
    if (response.args.initCallback) {
      response.args.initCallback();
    }
  }

  updateArgs(newArgs: NoisyArgs) {
    if (newArgs.updateArgsCallback) {
      newArgs.updateArgsCallback();
    }
  }
}

