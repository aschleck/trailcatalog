import { checkExists } from 'js/common/asserts';
import { deepEqual } from 'js/common/comparisons';

import { Controller, ControllerCtor, ControllerDeps, ControllerDepsMethod, ControllerResponse } from './controller';
import { EventSpec, qualifiedName } from './events';
import { isAnchorContextClick } from './mouse';
import { Service, ServiceDeps } from './service';
import { DepsConstructorsFor } from './types';

type IsPrefix<P extends unknown[], T> = P extends [...P, ...unknown[]] ? P : never;
type HasParameters<M, P extends unknown[], R> =
      M extends (...args: any) => any ? IsPrefix<Parameters<M>, P> extends never ? never : R : never;
type IsMethodWithParameters<T, K extends keyof T, P extends unknown[]> = HasParameters<T[K], P, K>;
type AMethodOnWithParameters<T, P extends unknown[]> = keyof {[K in keyof T as IsMethodWithParameters<T, K, P>]: 'valid'};

interface PropertyKeyToHandlerMap<C> {
  click: AMethodOnWithParameters<C, [CustomEvent<MouseEvent>]>,
  corgi: Array<[
    EventSpec<unknown>,
    AMethodOnWithParameters<C, [CustomEvent<unknown>]>,
  ]>;
  mousedown: AMethodOnWithParameters<C, [CustomEvent<MouseEvent>]>,
  mouseover: AMethodOnWithParameters<C, [CustomEvent<MouseEvent>]>,
  mouseout: AMethodOnWithParameters<C, [CustomEvent<MouseEvent>]>,
  mouseup: AMethodOnWithParameters<C, [CustomEvent<MouseEvent>]>,
  render: AMethodOnWithParameters<C, []>,
}

type StateTuple<S> = [S, (newState: S) => void];

interface BoundController<
        A,
        D extends ControllerDepsMethod,
        E extends HTMLElement,
        S,
        R extends ControllerResponse<A, D, E, S>,
        C extends Controller<A, D, E, S>
    > {
  args: A;
  controller: ControllerCtor<A, D, E, S, R, C>;
  events: Partial<PropertyKeyToHandlerMap<C>>;
  instance?: Promise<C>;
  key?: string; // controllers will only be reused if their keys match
  state: StateTuple<S>,
}

export interface AnyBoundController<E extends HTMLElement>
    extends BoundController<any, any, E, any, any, any> {}

export type UnboundEvents =
    Partial<{[k in keyof PropertyKeyToHandlerMap<AnyBoundController<HTMLElement>>]: string}>;

export interface InstantiationResult {
  root: Node;
  sideEffects: Array<() => void>;
  unboundEventss: Array<[HTMLElement, UnboundEvents]>;
}

const elementsToControllerSpecs = new WeakMap<HTMLElement, AnyBoundController<HTMLElement>>();

interface AnyServiceCtor {
  deps?(): DepsConstructorsFor<ServiceDeps>;
  new (response: any): Service<any>;
}
const serviceSingletons = new Map<AnyServiceCtor, Promise<Service<any>>>();

const unboundEventListeners =
    new WeakMap<HTMLElement, Array<[string, EventListenerOrEventListenerObject]>>();

export function applyUpdate(
    root: HTMLElement,
    from: AnyBoundController<HTMLElement>|undefined,
    to: AnyBoundController<HTMLElement>|undefined): void {
  if (from === undefined || to === undefined) {
    throw new Error("Unable to update bound element with new js or remove old js");
  }

  if (deepEqual(from.args, to.args)) {
    return;
  }

  from.args = to.args;
  if (from.instance) {
    from.instance.then(i => {
      i.updateArgs(to.args);
    });
  }
}

export function bind<
    A,
    D extends ControllerDepsMethod,
    E extends HTMLElement,
    S,
    R extends ControllerResponse<A, D, E, S>,
    C extends Controller<A, D, E, S>
>({args, controller, events, key, state}: {
  controller: ControllerCtor<A, D, E, S, R, C>,
  events?: Partial<PropertyKeyToHandlerMap<C>>,
  key?: string,
}
& ({} extends A ? {args?: never} : {args: A})
& (S extends undefined ? {state?: never} : {state: StateTuple<S>})
): BoundController<A, D, E, S, R, C> {
  return {
    args: args ?? {} as any,
    controller,
    events: events ?? {},
    key,
    state: state ?? [undefined, () => {}] as any,
  };
}

export function bindElementToSpec(
    root: HTMLElement,
    spec: AnyBoundController<HTMLElement>,
    unboundEventss: Array<[HTMLElement, UnboundEvents]>): Array<() => void> {
  elementsToControllerSpecs.set(root, spec);

  for (const [event, handler] of Object.entries(spec.events)) {
    if (event === 'corgi') {
      continue;
    }

    bindEventListener(root, event, handler as string, root, spec);
  }

  for (const [eventSpec, handler] of spec.events.corgi ?? []) {
    root.addEventListener(
        qualifiedName(eventSpec),
        e => {
          if (root === e.srcElement) {
            return;
          }

          e.preventDefault();
          e.stopPropagation();
          maybeInstantiateAndCall(root, spec, (controller: any) => {
            const method = controller[handler] as (e: CustomEvent<any>) => unknown;
            method.call(controller, e as CustomEvent<unknown>);
          });
        });
  }

  for (const [element, events] of unboundEventss) {
    for (const [event, handler] of Object.entries(events)) {
      bindEventListener(element, event, handler, root, spec);
    }
  }

  const sideEffects = [];
  if (spec.events.render) {
    const handler = spec.events.render;
    sideEffects.push(() => {
      maybeInstantiateAndCall(root, spec, (controller: any) => {
        const method = controller[handler];
        method.apply(controller, []);
      });
    });
  }
  return sideEffects;
}

export function applyInstantiationResult(result: InstantiationResult): void {
  result.sideEffects.forEach(e => { e(); });

  for (const [element, events] of result.unboundEventss) {
    const currentListeners = unboundEventListeners.get(element);
    if (currentListeners) {
      for (const [event, handler] of currentListeners) {
        element.removeEventListener(event, handler);
      }
    }

    let cursor: HTMLElement|null = element;
    while (cursor !== null && !elementsToControllerSpecs.has(cursor)) {
      cursor = cursor.parentElement;
    }

    if (cursor === null) {
      console.error('Event spec was unbound:');
      console.error(result.unboundEventss);
      continue;
    }

    const root = cursor;
    const spec = checkExists(elementsToControllerSpecs.get(root));

    const listeners: Array<[string, EventListenerOrEventListenerObject]> = [];
    for (const [event, handler] of Object.entries(events)) {
      if (!(handler in spec.controller.prototype)) {
        console.error(`Unable to bind ${event} to ${handler}, method doesn't exist`);
        continue;
      }

      const invoker = bindEventListener(element, event, handler, root, spec);
      listeners.push([event, invoker]);
    }
    unboundEventListeners.set(element, listeners);
  }
}

function maybeInstantiateAndCall<E extends HTMLElement>(
    root: E,
    spec: AnyBoundController<E>,
    fn: (controller: AnyBoundController<E>) => void): void {
  if (!spec.instance) {
    let deps;
    if (spec.controller.deps) {
      deps = fetchDeps(spec.controller.deps());
    } else {
      deps = Promise.resolve(() => ({}));
    }

    spec.instance = deps.then(d => {
      const instance = new spec.controller({
        root,
        args: spec.args,
        deps: d,
        state: spec.state,
      });
      root.setAttribute('js', '');
      return instance;
    });
  }

  spec.instance.then(instance => {
    fn(instance);
  });
}

function instantiateService(ctor: AnyServiceCtor): Promise<Service<any>> {
  let deps;
  if (ctor.deps) {
    deps = fetchDeps(ctor.deps());
  } else {
    deps = Promise.resolve({});
  }
  const instance = deps.then(d => new ctor({deps: d}));
  serviceSingletons.set(ctor, instance);
  return instance;
}

function fetchDeps<D extends ControllerDeps>(deps: DepsConstructorsFor<D>): Promise<D> {
  const response = {services: {}} as D;
  const promises = [];
  if (deps.services) {
    for (const [key, ctor] of Object.entries(deps.services)) {
      let service = serviceSingletons.get(ctor as AnyServiceCtor);
      if (!service) {
        service = instantiateService(ctor);
      }

      promises.push(service.then(instance => {
        response.services[key] = instance;
      }));
    }
  }
  return Promise.all(promises).then(() => response);
}

export function disposeBoundElementsIn(node: Node): void {
  if (!(node instanceof HTMLElement)) {
    return;
  }
  for (const root of [node, ...node.querySelectorAll('[js]')]) {
    const spec = elementsToControllerSpecs.get(root as HTMLElement);
    if (spec?.instance) {
      spec.instance.then(instance => {
        instance.dispose();
      });
    }
  }
}

function bindEventListener(
    element: HTMLElement,
    event: string,
    handler: string,
    root: HTMLElement,
    spec: AnyBoundController<HTMLElement>): (e: Event) => void {
  const invoker = (e: Event) => {
    if (isAnchorContextClick(e)) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    maybeInstantiateAndCall(root, spec, (controller: any) => {
      const method = controller[handler] as (e: any) => unknown;
      method.call(controller, e);
    });
  };
  element.addEventListener(event, invoker);
  return invoker;
}
