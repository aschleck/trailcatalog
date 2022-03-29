import { Controller, ControllerResponse } from './controller';
import { EventSpec, qualifiedName } from './events';

export const Fragment = Symbol();

type GenericController = Controller<HTMLElement, ControllerResponse<HTMLElement>>;

type ControllerCtor<ET extends HTMLElement, R extends ControllerResponse<ET>> =
    new (response: R) => Controller<ET, R>;

type GenericControllerCtor = ControllerCtor<HTMLElement, ControllerResponse<HTMLElement>>;

interface ControllerSpec {
  ctor: GenericControllerCtor;
  args?: unknown;
  instance?: GenericController;
}

const elementsToControllerSpecs = new Map<HTMLElement, ControllerSpec>();

interface PropertyKeyToHandlerMap {
  onEvents: Array<[EventSpec<unknown>, (this: GenericController, event: CustomEvent<any>) => void]>;
  onRender: () => void;
}

interface Properties<ET extends HTMLElement, R extends ControllerResponse<ET>> extends Partial<PropertyKeyToHandlerMap> {
  args?: object;
  jscontroller?: ControllerCtor<ET, R>;
  className?: string;
}

interface AnchorProperties extends Properties<HTMLAnchorElement, ControllerResponse<HTMLAnchorElement>> {
  href?: string;
}

class CorgiElement {
  constructor(
      public readonly element: HTMLElement,
      public readonly initialize: () => void,
  ) {}
}

interface VElement {
  element: keyof HTMLElementTagNameMap|'fragment';
  props: Properties<HTMLElement, ControllerResponse<HTMLElement>>;
}

type VElementOrPrimitive = VElement|number|string;

type ElementFactory = (
    props: Properties<HTMLElement, ControllerResponse<HTMLElement>>|null,
    ...children: VElementOrPrimitive[]
) => VElement;

interface VElement {
  children: VElementOrPrimitive[];
  factory?: ElementFactory;
}

export function createVirtualElement(
    element: keyof HTMLElementTagNameMap|ElementFactory|(typeof Fragment),
    props: Properties<HTMLElement, ControllerResponse<HTMLElement>>|null,
    ...children: VElementOrPrimitive[]): VElementOrPrimitive {
  if (typeof element === 'function') {
    const v = element(props, ...children);
    v.factory = element;
    return v;
  } else if (element === Fragment) {
    if (children.length === 1) {
      return children[0];
    } else {
      return {
        element: 'div',
        props: props ?? {},
        children,
      };
    }
  } else {
    return {
      element,
      props: props ?? {},
      children,
    };
  }
}

function maybeInstantiateAndCall(
    root: HTMLElement,
    spec: ControllerSpec,
    fn: (controller: GenericController) => void): void {
  if (!spec.instance) {
    spec.instance = new spec.ctor({
      root,
      args: spec.args,
    });
  }

  fn(spec.instance);
}

interface InstantiationResult {
  root: HTMLElement;
  sideEffects: Array<() => void>;
}

function createElement({element, props, children}: VElement): InstantiationResult {
  const root = document.createElement(element);
  let maybeSpec: ControllerSpec|undefined;
  const listeners: Partial<PropertyKeyToHandlerMap> = {};

  for (const [key, value] of Object.entries(props)) {
    if (key === 'jscontroller') {
      maybeSpec = {
        ctor: value,
        args: props?.args,
      };
    } else if (key === 'className') {
      const classes =
          value.split(' ')
              .map((c: string) => c.trim())
              .filter((c: string) => !!c);
      root.classList.add(...classes);
    } else if (key === 'onEvents') {
      listeners.onEvents = value;
    } else if (key === 'onRender') {
      listeners.onRender = value;
    } else {
      root.setAttribute(key, value);
    }
  }

  const sideEffects = [];

  for (const child of children) {
    if (typeof child === 'object') {
      const childResult = createElement(child);
      root.append(childResult.root);
      sideEffects.push(...childResult.sideEffects);
    } else {
      root.append(String(child));
    }
  }

  if (maybeSpec) {
    const spec = maybeSpec;
    elementsToControllerSpecs.set(root, spec);

    if (listeners.onEvents) {
      for (const [eventSpec, handler] of listeners.onEvents) {
        root.addEventListener(
            qualifiedName(eventSpec),
            e => {
              maybeInstantiateAndCall(root, spec, controller => {
                handler.apply(controller, [e as CustomEvent<unknown>]);
              });
            });
      }
    }
    if (listeners.onRender) {
      const handler = listeners.onRender;
      sideEffects.push(() => {
        maybeInstantiateAndCall(root, spec, controller => {
          handler.apply(controller);
        });
      });
    }
  }

  return {
    root,
    sideEffects,
  };
}

export function appendElement(parent: HTMLElement, child: VElementOrPrimitive): void {
  if (typeof child === 'object') {
    const result = createElement(child);
    parent.append(result.root);
    result.sideEffects.forEach(e => { e(); });
  } else {
    parent.append(String(child));
  }
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      a: AnchorProperties;
      canvas: Properties<HTMLCanvasElement, ControllerResponse<HTMLCanvasElement>>;
      div: Properties<HTMLDivElement, ControllerResponse<HTMLDivElement>>;
    }
  }
}

function isCorgiElement(v: unknown): v is CorgiElement {
  return v instanceof CorgiElement;
}
