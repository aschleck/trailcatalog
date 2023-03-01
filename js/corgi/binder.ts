import { checkExists } from 'js/common/asserts';
import { deepEqual } from 'js/common/comparisons';
import { Disposable } from 'js/common/disposable';

import { Controller, ControllerCtor, ControllerDeps, ControllerDepsMethod, Response as ControllerResponse } from './controller';
import { elementFinder, SupportedElement } from './dom';
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
  change: AMethodOnWithParameters<C, [CustomEvent<Event>]>,
  click: AMethodOnWithParameters<C, [CustomEvent<MouseEvent>]>,
  corgi: Array<[
    EventSpec<unknown>,
    AMethodOnWithParameters<C, [CustomEvent<unknown>]>,
  ]>;
  keydown: AMethodOnWithParameters<C, [CustomEvent<KeyboardEvent>]>,
  keyup: AMethodOnWithParameters<C, [CustomEvent<KeyboardEvent>]>,
  // This is wrong, it could also just be Event, but also I don't care
  input: AMethodOnWithParameters<C, [CustomEvent<InputEvent>]>,
  mousedown: AMethodOnWithParameters<C, [CustomEvent<MouseEvent>]>,
  mouseover: AMethodOnWithParameters<C, [CustomEvent<MouseEvent>]>,
  mouseout: AMethodOnWithParameters<C, [CustomEvent<MouseEvent>]>,
  mouseup: AMethodOnWithParameters<C, [CustomEvent<MouseEvent>]>,
  pointerdown: AMethodOnWithParameters<C, [CustomEvent<PointerEvent>]>,
  pointerleave: AMethodOnWithParameters<C, [CustomEvent<PointerEvent>]>,
  pointermove: AMethodOnWithParameters<C, [CustomEvent<PointerEvent>]>,
  pointerover: AMethodOnWithParameters<C, [CustomEvent<PointerEvent>]>,
  pointerup: AMethodOnWithParameters<C, [CustomEvent<PointerEvent>]>,
  render: AMethodOnWithParameters<C, []>,
}

type StateTuple<S> = [S, (newState: S) => void];

interface BoundController<C extends Controller<any, any, any, any>> {
  args: C['_A'];
  controller: ControllerCtor<C>;
  disposer: Disposable;
  events: Partial<PropertyKeyToHandlerMap<C>>;
  instance?: Promise<C>;
  key?: string; // controllers will only be reused if their keys match
  ref?: string;
  state: StateTuple<C['_S']>,
}

export interface AnyBoundController extends BoundController<any> {}

export type UnboundEvents =
    Partial<
      Omit<{
        [k in keyof PropertyKeyToHandlerMap<AnyBoundController>]: string
      }, 'corgi'> & {
        corgi: Array<[EventSpec<unknown>, string]>;
      }
    >;
;

export interface InstantiationResult {
  root: Node;
  sideEffects: Array<() => void>;
  unboundEventss: Array<[SupportedElement, UnboundEvents]>;
}

const elementsToControllerSpecs = new WeakMap<SupportedElement, AnyBoundController>();

interface AnyServiceCtor {
  deps?(): DepsConstructorsFor<ServiceDeps>;
  new (response: any): Service<any>;
}
const serviceSingletons = new Map<AnyServiceCtor, Promise<Service<any>>>();

const unboundEventListeners =
    new WeakMap<SupportedElement, Array<[string, EventListenerOrEventListenerObject]>>();

export function applyUpdate(
    root: SupportedElement,
    from: AnyBoundController|undefined,
    to: AnyBoundController|undefined): void {
  if (from === undefined || to === undefined) {
    throw new Error("Unable to update bound element with new js or remove old js");
  }

  if (deepEqual(from.args, to.args)) {
    return;
  }

  from.args = to.args;
  const spec = elementsToControllerSpecs.get(root);
  if (spec?.instance) {
    spec.instance.then(i => {
      i.updateArgs(to.args);
    });
  }
}

export function bind<C extends Controller<any, any, any, any>>({
  args,
  controller,
  events,
  key,
  ref,
  state,
}: {
  controller: ControllerCtor<C>,
  events?: Partial<PropertyKeyToHandlerMap<C>>,
  key?: string,
  ref?: string,
}
& ({} extends C['_A'] ? {args?: {}} : {args: C['_A']})
& (undefined extends C['_S'] ? {state?: never} : {state: StateTuple<C['_S']>})
): BoundController<C> {
  return {
    args: args ?? {} as any,
    controller,
    disposer: new Disposable(),
    events: events ?? {},
    key,
    ref,
    state: state ?? [undefined, () => {}] as any,
  };
}

export function bindElementToSpec(
    root: SupportedElement,
    spec: AnyBoundController,
    unboundEventss: Array<[SupportedElement, UnboundEvents]>): Array<() => void> {
  elementsToControllerSpecs.set(root, spec);

  for (const [event, handler] of Object.entries(spec.events)) {
    if (event === 'corgi') {
      continue;
    }

    bindEventListener(root, event, handler as string, root, spec);
  }

  for (const [eventSpec, handler] of spec.events.corgi ?? []) {
    spec.disposer.registerListener(
        root,
        qualifiedName(eventSpec) as any,
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
      if (event === 'corgi') {
        continue;
      }

      bindEventListener(element, event, handler as string, root, spec);
    }

    for (const [eventSpec, handler] of events.corgi ?? []) {
      spec.disposer.registerListener(
          element,
          qualifiedName(eventSpec) as any,
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
    let cursor: SupportedElement|null = element;
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

    for (const [event, handler] of Object.entries(events)) {
      if (event === 'corgi') {
        continue;
      }

      const shandler = handler as string;

      if (!(shandler in spec.controller.prototype)) {
        console.error(`Unable to bind ${event} to ${handler}, method doesn't exist`);
        continue;
      }

      const invoker = bindEventListener(element, event, shandler, root, spec);
    }

    for (const [eventSpec, handler] of events.corgi ?? []) {
      const invoker = (e: Event) => {
        if (root === e.srcElement) {
          return;
        }

        e.preventDefault();
        e.stopPropagation();
        maybeInstantiateAndCall(root, spec, (controller: any) => {
          const method = controller[handler] as (e: CustomEvent<any>) => unknown;
          method.call(controller, e as CustomEvent<unknown>);
        });
      };
      const event = qualifiedName(eventSpec);
      spec.disposer.registerListener(element, event as any, invoker);
    }
  }
}

function maybeInstantiateAndCall<E extends SupportedElement, R>(
    root: E,
    spec: AnyBoundController,
    fn: (controller: AnyBoundController) => R): Promise<R> {
  if (!spec.instance) {
    let deps;
    if (spec.controller.deps) {
      deps = fetchControllerDeps(spec.controller.deps(), root);
    } else {
      deps = Promise.resolve({});
    }

    spec.instance = deps.then(d => {
      const instance = new spec.controller({
        root,
        args: spec.args,
        deps: d,
        state: spec.state,
      });
      spec.disposer.registerDisposable(instance);
      return instance;
    });
  }

  return spec.instance.then(instance => fn(instance));
}

function fetchControllerDeps<D extends ControllerDeps>(
    deps: DepsConstructorsFor<D>, root: SupportedElement): Promise<D> {
  const response: D = {controllers: {}, controllerss: {}, services: {}} as D;
  const promises: Array<Promise<unknown>> = [];

  for (const [key, untypedCtor] of Object.entries(deps.controllers ?? {})) {
    const ctor = untypedCtor as ControllerCtor<any>;

    const elements =
        elementFinder(
            root,
            candidate => candidate.getAttribute('data-js-ref') === key,
            parent => !parent.hasAttribute('data-js'));
    if (elements.length > 1) {
      throw new Error(`Key ${key} matched multiple controllers`);
    } else if (elements.length === 0) {
      throw new Error(`Key ${key} did not match any controllers`);
    }

    const element = elements[0];
    const spec = checkExists(elementsToControllerSpecs.get(element));
    promises.push(
        maybeInstantiateAndCall(element, spec, (controller: any) => {
          if (ctor !== controller.constructor) {
            throw new Error(`Key ${key} matched a non-${ctor.name} controller`);
          }
          response.controllers[key] = controller;
        }));
  }

  for (const [key, untypedCtor] of Object.entries(deps.controllerss ?? {})) {
    const ctor = untypedCtor as ControllerCtor<any>;

    const elements =
        elementFinder(
            root,
            candidate => candidate.getAttribute('data-js-ref') === key,
            parent => !parent.hasAttribute('data-js'));

    const instances = [];
    for (const element of elements) {
      const spec = checkExists(elementsToControllerSpecs.get(element));
      instances.push(
          maybeInstantiateAndCall(element, spec, (controller: any) => {
            if (ctor !== controller.constructor) {
              throw new Error(`Key ${key} matched a non-${ctor.name} controller`);
            }
            return controller;
          }));
    }

    promises.push(
        Promise.all(instances).then(is => {
          response.controllerss[key] = is;
        }));
  }

  return Promise.all(promises)
      .then(() => fetchServiceDeps(deps))
      .then(sr => Object.assign(response, sr));
}

function instantiateService(ctor: AnyServiceCtor): Promise<Service<any>> {
  let deps;
  if (ctor.deps) {
    deps = fetchServiceDeps(ctor.deps());
  } else {
    deps = Promise.resolve({});
  }
  const instance = deps.then(d => new ctor({deps: d}));
  serviceSingletons.set(ctor, instance);
  return instance;
}

export function fetchServiceDeps<D extends ServiceDeps>(deps: DepsConstructorsFor<D>): Promise<D> {
  const response = {services: {}} as D;
  const promises = [];
  for (const [key, untypedCtor] of Object.entries(deps.services ?? {})) {
    const ctor = untypedCtor as AnyServiceCtor;

    let service = serviceSingletons.get(ctor);
    if (!service) {
      service = instantiateService(ctor);
    }

    promises.push(service.then(instance => {
      response.services[key] = instance;
    }));
  }
  return Promise.all(promises).then(() => response);
}

export function disposeBoundElementsIn(node: Node): void {
  if (!(node instanceof HTMLElement) && !(node instanceof SVGElement)) {
    return;
  }
  for (const root of [node, ...node.querySelectorAll('[data-js]')]) {
    const spec = elementsToControllerSpecs.get(root as SupportedElement);
    spec?.disposer.dispose();
  }
}

function bindEventListener(
    element: SupportedElement,
    event: string,
    handler: string,
    root: SupportedElement,
    spec: AnyBoundController): (e: Event) => void {
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
  spec.disposer.registerListener(element, event as any, invoker);
  return invoker;
}
