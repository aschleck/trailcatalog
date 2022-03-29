import { Controller, ControllerResponse } from './controller';

export const Fragment = Symbol();

type ControllerCtor<ET extends HTMLElement, R extends ControllerResponse<ET>> =
    new (response: R) => Controller<ET, R>;

interface Properties<ET extends HTMLElement, R extends ControllerResponse<ET>> {
  args?: object;
  jscontroller?: ControllerCtor<ET, R>;
  onRender?: () => void;
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
  element:
      keyof HTMLElementTagNameMap
          |(typeof Fragment)
          |((
               props: Properties<HTMLElement, ControllerResponse<HTMLElement>>|null,
               ...children: Array<CorgiElement|string>
           ) => CorgiElement);
  props: Properties<HTMLElement, ControllerResponse<HTMLElement>>|null;
  children: Array<CorgiElement|number|string>;
}

export function createElement(
    element:
        keyof HTMLElementTagNameMap
            |(typeof Fragment)
            |((
                 props: Properties<HTMLElement, ControllerResponse<HTMLElement>>|null,
                 ...children: Array<CorgiElement|string>
             ) => CorgiElement),
    props: Properties<HTMLElement, ControllerResponse<HTMLElement>>|null,
    ...children: Array<CorgiElement|string>): CorgiElement|string {
  if (typeof element === 'function') {
    return element(props, ...children);
  } else if (element === Fragment) {
    if (children.length === 1) {
      return children[0];
    } else {
      return createElement('div', null, ...children);
    }
  } else {
    const created = document.createElement(element);
    let initialize = () => {
      children.filter(isCorgiElement).forEach(c => {
        c.initialize();
      });
    };
    for (const [key, value] of Object.entries(props ?? {})) {
      if (key === 'jscontroller') {
        const ctor = value as ControllerCtor<HTMLElement, ControllerResponse<HTMLElement>>;
        initialize = () => {
          children.filter(isCorgiElement).forEach(c => {
            c.initialize();
          });
          new ctor({
            root: created,
            args: props?.args,
          });
        };
      } else if (key === 'className') {
        const classes = (value as string).split(' ');
        created.classList.add(...classes);
      }
    }
    for (const child of children) {
      if (child instanceof CorgiElement) {
        created.append(child.element);
      } else {
        created.append(child);
      }
    }
    return new CorgiElement(
      created,
      initialize,
    );
  }
}

export function appendElement(parent: HTMLElement, child: CorgiElement|string): void {
  if (child instanceof CorgiElement) {
    parent.append(child.element);
    child.initialize();
  } else {
    parent.append(child);
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
