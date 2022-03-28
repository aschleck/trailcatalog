import { Controller } from './controller';

export const Fragment = Symbol();

interface Properties<ET extends HTMLElement> {
  jscontroller?: new (root: ET) => Controller<ET>;
  className?: string;
}

interface AnchorProperties extends Properties<HTMLAnchorElement> {
  href?: string;
}

class CorgiElement {
  constructor(
      public readonly element: HTMLElement,
      public readonly initialize: () => void,
  ) {}
}

export function createElement(
    element:
        keyof HTMLElementTagNameMap
            |(typeof Fragment)
            |((
                 props: Properties<HTMLElement>|null,
                 children: Array<CorgiElement|string>
             ) => CorgiElement),
    props: Properties<HTMLElement>|null,
    ...children: Array<CorgiElement|string>): CorgiElement|string {
  if (typeof element === 'function') {
    throw new Error('wtf');
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
        const ctor = value as new (root: HTMLElement) => Controller<HTMLElement>;
        initialize = () => {
          children.filter(isCorgiElement).forEach(c => {
            c.initialize();
          });
          new ctor(created);
        };
      } else if (key === 'className') {
        const classes = (value as string).split(' ');
        created.classList.add(...classes);
      }
      for (const child of children) {
        if (typeof child === 'string') {
          created.append(child);
        } else {
          created.append(child.element);
        }
      }
    }
    return new CorgiElement(
      created,
      initialize,
    );
  }
}

export function appendElement(parent: HTMLElement, child: CorgiElement|string): void {
  if (typeof child === 'string') {
    parent.append(child);
  } else {
    parent.append(child.element);
    child.initialize();
  }
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      a: AnchorProperties;
      canvas: Properties<HTMLCanvasElement>;
      div: Properties<HTMLDivElement>;
    }
  }
}

function isCorgiElement(v: unknown): v is CorgiElement {
  return v instanceof CorgiElement;
}
