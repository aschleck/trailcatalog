import { checkExists } from 'js/common/asserts';

import { AnyBoundController, applyInstantiationResult, bindElementToSpec, disposeBoundElementsIn, InstantiationResult, UnboundEvents } from './binder';
import { deepEqual } from './comparisons';

export const Fragment = Symbol();
export { bind } from './binder';

export interface Properties<E extends HTMLElement> {
  children?: VElementOrPrimitive[];
  className?: string;
  js?: AnyBoundController<E|HTMLElement>;
  style?: string; // TODO(april): this is sad
  unboundEvents?: UnboundEvents;
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

type VHandle = object & {brand: 'VHandle'};

interface VElement {
  element: keyof HTMLElementTagNameMap;
  props: Properties<HTMLElement>;

  factory?: ElementFactory;
  factoryProps?: Properties<HTMLElement>;
  handle?: VHandle,
  state?: [object|undefined, (newState: object) => void];

  children: VElementOrPrimitive[];
}

export type VElementOrPrimitive = VElement|number|string;

type ElementFactory = (
    props: Properties<HTMLElement>|null,
    state: unknown,
    updateState: (newState: object) => void,
) => VElement;

interface VContext {
  liveChildren: VElementOrPrimitive[];
  reconstructed: number;
}

const vElementPath: VContext[] = [];
const vElements = new WeakSet<VElement>();
const vElementsToNodes = new WeakMap<VElement, Node>();
const vHandlesToElements = new WeakMap<VHandle, VElement>();

export function createVirtualElement(
    element: keyof HTMLElementTagNameMap|ElementFactory|(typeof Fragment),
    props: Properties<HTMLElement>|null,
    ...children: Array<VElementOrPrimitive|VElementOrPrimitive[]>): VElementOrPrimitive {
  const allChildren = [];
  for (const c of children) {
    if (c instanceof Array) {
      allChildren.push(...c);
    } else {
      allChildren.push(c);
    }
  }
  // In the DOM adjacent text nodes get merged, so merge them here too.
  const expandChildren: typeof allChildren = [];
  for (let i = 0; i < allChildren.length; ++i) {
    const child = allChildren[i];
    if (child instanceof Object || i === 0) {
      expandChildren.push(child);
    } else if (child === '') {
      continue;
    } else {
      const previous = expandChildren[expandChildren.length - 1];
      if (!(previous instanceof Object)) {
        expandChildren[expandChildren.length - 1] = `${previous}${child}`;
      } else {
        expandChildren.push(child);
      }
    }
  }

  props = props ?? {};

  if (typeof element === 'function') {
    // Don't let the TSX method corrupt our props
    const propClone = Object.assign({}, props);
    propClone.children = expandChildren;

    let previousElement;
    if (vElementPath.length > 0) {
      const top = vElementPath[vElementPath.length - 1];
      if (top.liveChildren.length > top.reconstructed) {
        const candidate = top.liveChildren[top.reconstructed];
        if (typeof candidate == 'object' && candidate.factory === element) {
          previousElement = candidate;
        }
      }
      top.reconstructed += 1;
    }

    // Optimistic check
    if (previousElement && deepEqual(props, checkExists(previousElement.factoryProps))) {
      return previousElement;
    }

    let handle;
    let state: object|undefined;
    let updateState;
    if (previousElement) {
      handle = checkExists(previousElement.handle);
      state = checkExists(previousElement.state)[0];
      updateState = checkExists(previousElement.state)[1];

      vElementPath.push({
        liveChildren: previousElement.children,
        reconstructed: 0,
      });
    } else {
      const h = {} as VHandle;
      handle = h;
      updateState = (newState: object) => {
        const v = vHandlesToElements.get(h);
        if (v) {
          updateToState(v, newState);
        }
      };

      vElementPath.push({
        liveChildren: [],
        reconstructed: 0,
      });
    }

    let v;
    try {
      v = element(propClone, state, updateState);
    } finally {
      vElementPath.pop();
    }

    if (vElements.has(v)) {
      // there is a gnarly bug to be careful about: if a <A /> is defined as A = <B /> then A will
      // return the result of B directly. We therefore need to make sure we don't create a v element
      // for the result of B tied to A, because A is irrelevant.
    } else {
      v.factory = element;
      v.factoryProps = props;
      v.handle = handle;
      v.state = [state, updateState];
      vElements.add(v);
      vHandlesToElements.set(handle, v);
    }

    return v;
  } else if (element === Fragment) {
    if (expandChildren.length === 1) {
      return expandChildren[0];
    } else {
      return {
        element: 'div',
        props,
        children: expandChildren,
      };
    }
  } else {
    return {
      element,
      props,
      children: expandChildren,
    };
  }
}

function updateToState(element: VElement, newState: object): void {
  if (vElementPath.length > 0) {
    throw new Error('Unable to handle vElementPath.length > 0');
  }

  if (!element.factory || !element.state) {
    throw new Error('Cannot update element without a factory');
  }

  const node = vElementsToNodes.get(element);
  if (!node) {
    return;
  }

  vElementPath.push({
    liveChildren: element.children,
    reconstructed: 0,
  });
  let newElement;
  try {
    newElement = element.factory(element.factoryProps ?? null, newState, element.state[1]);
  } finally {
    vElementPath.pop();
  }

  const result = applyUpdate(element, newElement);
  if (node !== result.root) {
    node.parentNode?.replaceChild(result.root, node);
  }

  Object.assign(element, newElement);
  vElementsToNodes.set(element, node);
  applyInstantiationResult(result);
}

function applyUpdate(from: VElement|undefined, to: VElement): InstantiationResult {
  if (!from
      || from.element !== to.element
      || from.props.js?.controller !== to.props.js?.controller) {
    const element = createElement(to);
    vElementsToNodes.set(to, element.root);
    return element;
  }

  const node = vElementsToNodes.get(from) as HTMLElement;
  if (!node) {
    throw new Error('Expecting an existing node but unable to find it');
  }
  const result: InstantiationResult = {
    root: node,
    sideEffects: [],
    unboundEventss: [],
  };

  const oldPropKeys = Object.keys(from.props) as Array<keyof Properties<HTMLElement>>;
  const newPropKeys = Object.keys(to.props) as Array<keyof Properties<HTMLElement>>;
  for (const key of newPropKeys) {
    if (key === 'children' || key === 'js') {
      continue;
    }

    if (!deepEqual(from.props[key], to.props[key])) {
      if (key === 'className') {
        node.className = checkExists(to.props[key]);
      } else if (key === 'unboundEvents') {
        result.unboundEventss.push([node, checkExists(to.props[key])]);
      } else {
        node.setAttribute(key, checkExists(to.props[key]));
      }
    }
  }
  for (const key of oldPropKeys) {
    if (!to.props.hasOwnProperty(key)) {
      if (key === 'unboundEvents') {
        result.unboundEventss.push([node, {}]);
      } else {
        node.removeAttribute(key === 'className' ? 'class' : key);
      }
    }
  }

  const oldChildren = [...node.childNodes];
  for (let i = 0; i < to.children.length; ++i) {
    const was = from.children[i];
    const is = to.children[i];

    if (was === is) {
      continue;
    }

    if (typeof was !== 'object' || typeof is !== 'object') {
      const childResult = createElement(is);
      if (i < oldChildren.length) {
        const old = node.childNodes[i];
        node.replaceChild(childResult.root, old);
        result.sideEffects.push(() => { disposeBoundElementsIn(old); });
      } else {
        node.appendChild(childResult.root);
      }
      result.sideEffects.push(...childResult.sideEffects);
      result.unboundEventss.push(...childResult.unboundEventss);
      continue;
    }

    const childResult = applyUpdate(was, is);
    const oldNode = was?.element ? vElementsToNodes.get(was) : undefined;
    if (!oldNode) {
      node.appendChild(childResult.root);
    } else if (oldNode !== childResult.root) {
      node.replaceChild(childResult.root, oldNode);
      result.sideEffects.push(() => { disposeBoundElementsIn(oldNode); });
    }
    result.sideEffects.push(...childResult.sideEffects);
    result.unboundEventss.push(...childResult.unboundEventss);
  }
  for (let i = to.children.length; i < from.children.length; ++i) {
    const old = checkExists(node.lastChild);
    old.remove();
    result.sideEffects.push(() => { disposeBoundElementsIn(old); });
  }

  vElementsToNodes.set(to, result.root);
  return result;
}

function createElement(element: VElementOrPrimitive): InstantiationResult {
  if (typeof element !== 'object') {
    return {
      root: new Text(String(element)),
      sideEffects: [],
      unboundEventss: [],
    };
  }

  const root = document.createElement(element.element);
  vElementsToNodes.set(element, root);
  let maybeSpec: AnyBoundController<HTMLElement>|undefined;
  let unboundEventss: Array<[HTMLElement, UnboundEvents]> = [];

  const props = element.props;
  for (const [key, value] of Object.entries(props)) {
    if (key === 'js') {
      maybeSpec = value;
    } else if (key === 'unboundEvents') {
      unboundEventss.push([root, value]);
    } else if (key === 'className') {
      root.className = value;
    } else {
      root.setAttribute(key, value);
    }
  }

  if (maybeSpec && unboundEventss.length > 0) {
    throw new Error('Cannot specify both js and unboundEvents');
  }

  const sideEffects = [];

  for (const child of element.children) {
    const childResult = createElement(child);
    root.append(childResult.root);
    sideEffects.push(...childResult.sideEffects);
    unboundEventss.push(...childResult.unboundEventss);
  }

  if (maybeSpec) {
    sideEffects.push(...bindElementToSpec(root, maybeSpec, unboundEventss));
    unboundEventss.length = 0;
  }

  return {
    root,
    sideEffects,
    unboundEventss,
  };
}

export function appendElement(parent: HTMLElement, child: VElementOrPrimitive): void {
  if (typeof child === 'object') {
    const result = createElement(child);
    parent.append(result.root);
    applyInstantiationResult(result);
  } else {
    parent.append(String(child));
  }
}

export function hydrateTree(parent: HTMLElement, tree: VElementOrPrimitive): void {
  if (parent.childNodes.length !== 1) {
    throw new Error("Unable to hydrate, parent has multiple children");
  }

  const result = hydrateElement(parent.childNodes[0], tree);
  applyInstantiationResult(result);
}

function hydrateElement(root: ChildNode, element: VElementOrPrimitive): InstantiationResult {
  if (typeof element !== 'object') {
    return {
      root: new Text(String(element)),
      sideEffects: [],
      unboundEventss: [],
    };
  }

  if (!(root instanceof HTMLElement)) {
    throw new Error("Cannot hydrate non-element root");
  }
  if (root.tagName !== element.element.toUpperCase()) {
    throw new Error(
        `Mismatched tag type: ${root.tagName} != ${element.element}`);
  }
  if (root.childNodes.length !== element.children.length) {
    throw new Error(
        `Mismatched child count: ${root.childNodes.length} != ${element.children.length}`);
  }

  vElementsToNodes.set(element, root);
  let maybeSpec: AnyBoundController<HTMLElement>|undefined;
  let unboundEventss: Array<[HTMLElement, UnboundEvents]> = [];

  const props = element.props;
  for (const [key, value] of Object.entries(props)) {
    if (key === 'js') {
      maybeSpec = value;
    } else if (key === 'unboundEvents') {
      unboundEventss.push([root, value]);
    }
  }

  if (maybeSpec && unboundEventss.length > 0) {
    throw new Error('Cannot specify both js and unboundEvents');
  }

  const sideEffects = [];

  for (let i = 0; i < element.children.length; ++i) {
    const childResult = hydrateElement(root.childNodes[i], element.children[i]);
    sideEffects.push(...childResult.sideEffects);
    unboundEventss.push(...childResult.unboundEventss);
  }

  if (maybeSpec) {
    sideEffects.push(...bindElementToSpec(root, maybeSpec, unboundEventss));
    unboundEventss.length = 0;
  }

  return {
    root,
    sideEffects,
    unboundEventss,
  };
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      a: AnchorProperties;
      aside: Properties<HTMLElement>;
      canvas: Properties<HTMLCanvasElement>;
      div: Properties<HTMLDivElement>;
      footer: Properties<HTMLElement>;
      header: Properties<HTMLElement>;
      i: Properties<HTMLElement>;
      section: Properties<HTMLElement>;
      span: Properties<HTMLSpanElement>;
    }
  }
}

function isCorgiElement(v: unknown): v is CorgiElement {
  return v instanceof CorgiElement;
}

