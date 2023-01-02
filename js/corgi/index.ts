import { checkExists } from 'js/common/asserts';
import { deepEqual } from 'js/common/comparisons';

import { AnyBoundController, applyInstantiationResult, applyUpdate as applyBinderUpdate, bindElementToSpec, disposeBoundElementsIn, InstantiationResult, UnboundEvents } from './binder';

export const Fragment = Symbol();
export { bind } from './binder';

export interface Properties<E extends HTMLElement|SVGElement> {
  children?: VElementOrPrimitive|VElementOrPrimitive[],
  className?: string;
  js?: AnyBoundController<E|HTMLElement|SVGElement>;
  style?: string; // TODO(april): this is sad
  tabIndex?: string;
  title?: string;
  unboundEvents?: UnboundEvents;
}

export interface AnchorProperties extends Properties<HTMLAnchorElement> {
  href?: string;
  target?: '_self'|'_blank'|'_parent'|'_top';
}

export interface GroupProperties extends Properties<SVGGElement> {}

export interface ImageProperties extends Properties<HTMLImageElement> {
  alt?: string;
  height?: string;
  src?: string;
  width?: string;
}

export interface InputProperties extends Properties<HTMLInputElement> {
  type?: 'password'|'text';
  placeholder?: string;
  value?: string;
}

export interface LineProperties extends Properties<SVGLineElement> {
  stroke?: string;
  x1: number|string;
  y1: number|string;
  x2: number|string;
  y2: number|string;
  vector_effect?: 'none'|'non-scaling-stroke'|'non-scaling-size'|'non-rotation'|'fixed-position';
}

export interface PolylineProperties extends Properties<SVGPolylineElement> {
  fill?: string;
  stroke?: string;
  stroke_width?: number|string;
  points: string;
  vector_effect?: 'none'|'non-scaling-stroke'|'non-scaling-size'|'non-rotation'|'fixed-position';
}

export interface SVGProperties extends Properties<SVGElement> {
  height?: number|string;
  viewBox?: string;
  width?: number|string;
}

export interface TextProperties extends Properties<SVGTextElement> {
  dominant_baseline?:
      'auto'|'text-bottom'|'alphabetic'|'ideographic'|'middle'|'central'|'mathematical'|'hanging'
            |'text-top';
  text_anchor?: 'start'|'middle'|'end';
  vector_effect?: 'none'|'non-scaling-stroke'|'non-scaling-size'|'non-rotation'|'fixed-position';
  x?: number|string;
  y?: number|string;
  dx?: number|string;
  dy?: number|string;
}

class CorgiElement {
  constructor(
      public readonly element: HTMLElement,
      public readonly initialize: () => void,
  ) {}
}

type VHandle = object & {brand: 'VHandle'};

export const FRAGMENT_TAG = 'fragment';

interface VElement {
  element: keyof HTMLElementTagNameMap|typeof FRAGMENT_TAG;
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
    if (child === '') {
      continue;
    } else if (child instanceof Object || i === 0) {
      expandChildren.push(child);
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
    if (
        previousElement
            && deepEqual(props, checkExists(previousElement.factoryProps))
            && deepEqual(expandChildren, previousElement.children)) {
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

    v.factory = element;
    v.factoryProps = props;
    v.handle = handle;
    v.state = [state, updateState];
    vElements.add(v);
    vHandlesToElements.set(handle, v);

    return v;
  } else if (element === Fragment) {
    return {
      element: FRAGMENT_TAG,
      props,
      children: expandChildren,
    };
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

  let oldExpand;
  if (element.element === FRAGMENT_TAG) {
    oldExpand = expandFragments(element.children);
  } else {
    oldExpand = [element];
  }
  let newExpand;
  if (newElement.element === FRAGMENT_TAG) {
    newExpand = expandFragments(newElement.children);
  } else {
    newExpand = [newElement];
  }

  if (oldExpand.length !== newExpand.length) {
    throw new Error('Cannot change child count with fragment state update');
  }

  for (let i = 0; i < oldExpand.length; ++i) {
    const was = oldExpand[i];
    const is = newExpand[i];

    if (typeof was !== 'object' || typeof is !== 'object') {
      throw new Error('Cannot update primitive fragment children');
    }

    const node = vElementsToNodes.get(was);
    if (!node) {
      console.error('Stale state update, or terrifying bug');
      return;
    }

    const result = applyUpdate(was, is);
    if (node !== result.root) {
      node.parentNode?.replaceChild(result.root, node);
    }

    Object.assign(was, is);
    vElementsToNodes.set(was, result.root);
    applyInstantiationResult(result);
  }
}

function applyUpdate(from: VElement|undefined, to: VElement): InstantiationResult {
  if (to.element === FRAGMENT_TAG) {
    throw new Error('Not supposed to get fragments here');
  }

  if (!from
      || from.element !== to.element
      || from.props.js?.controller !== to.props.js?.controller
      || from.props.js?.key !== to.props.js?.key
      || from.props.js?.ref !== to.props.js?.ref) {
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
    if (key === 'children') {
      continue;
    } else if (key === 'js') {
      applyBinderUpdate(node, from.props[key], to.props[key]);
      continue;
    }

    if (!deepEqual(from.props[key], to.props[key])) {
      if (key === 'className') {
        node.className = checkExists(to.props[key]);
      } else if (key === 'unboundEvents') {
        result.unboundEventss.push([node, checkExists(to.props[key])]);
      } else {
        node.setAttribute(key.replace('_', '-'), checkExists(to.props[key]));
      }
    }
  }
  for (const key of oldPropKeys) {
    if (!to.props.hasOwnProperty(key)) {
      if (key === 'unboundEvents') {
        result.unboundEventss.push([node, {}]);
      } else {
        node.removeAttribute(key === 'className' ? 'class' : key.replace('_', '-'));
      }
    }
  }

  const oldChildren = [...node.childNodes];
  const fromChildren = expandFragments(from.children);
  const toChildren = expandFragments(to.children);
  for (let i = 0; i < toChildren.length; ++i) {
    const was = fromChildren[i];
    const is = toChildren[i];

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
  for (let i = toChildren.length; i < fromChildren.length; ++i) {
    const old = checkExists(node.lastChild);
    old.remove();
    result.sideEffects.push(() => { disposeBoundElementsIn(old); });
  }

  vElementsToNodes.set(to, result.root);
  return result;
}

const TAG_TO_NAMESPACE = new Map([
  ['g', 'http://www.w3.org/2000/svg'],
  ['line', 'http://www.w3.org/2000/svg'],
  ['polyline', 'http://www.w3.org/2000/svg'],
  ['svg', 'http://www.w3.org/2000/svg'],
  ['text', 'http://www.w3.org/2000/svg'],
]);

function createElement(element: VElementOrPrimitive): InstantiationResult {
  if (typeof element !== 'object') {
    return {
      root: new Text(String(element)),
      sideEffects: [],
      unboundEventss: [],
    };
  }

  if (element.element === FRAGMENT_TAG) {
    throw new Error('Not supposed to get fragments here');
  }

  const ns = TAG_TO_NAMESPACE.get(element.element) ?? 'http://www.w3.org/1999/xhtml';
  const root = document.createElementNS(ns, element.element) as HTMLElement|SVGElement;
  vElementsToNodes.set(element, root);
  let maybeSpec: AnyBoundController<HTMLElement|SVGElement>|undefined;
  let unboundEventss: Array<[HTMLElement|SVGElement, UnboundEvents]> = [];

  const props = element.props;
  for (const [key, value] of Object.entries(props)) {
    if (key === 'js') {
      maybeSpec = value;
      root.setAttribute('data-js', '');
      if (value.ref) {
        root.setAttribute('data-js-ref', value.ref);
      }
    } else if (key === 'unboundEvents') {
      unboundEventss.push([root, value]);
    } else if (key === 'className') {
      root.setAttribute('class', value);
    } else {
      root.setAttribute(key.replace('_', '-'), value);
    }
  }

  if (maybeSpec && unboundEventss.length > 0) {
    throw new Error('Cannot specify both js and unboundEvents');
  }

  const sideEffects = [];

  for (const child of expandFragments(element.children)) {
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

export function appendElement(parent: HTMLElement|SVGElement, child: VElementOrPrimitive): void {
  if (typeof child === 'object') {
    if (child.element === FRAGMENT_TAG) {
      throw new Error('Fragments are unsupported');
    }

    const result = createElement(child);
    parent.append(result.root);
    applyInstantiationResult(result);
  } else {
    parent.append(new Text(String(child)));
  }
}

export function hydrateTree(parent: HTMLElement|SVGElement, tree: VElementOrPrimitive): void {
  let expanded;
  if (typeof tree === 'object' && tree.element === FRAGMENT_TAG) {
    expanded = expandFragments(tree.children);
  } else {
    expanded = [tree];
  }

  if (expanded.length !== parent.childNodes.length) {
    throw new Error(
        `Parent has ${parent.childNodes.length} children but expected ${expanded.length}`);
  }

  for (let i = 0; i < expanded.length; ++i) {
    applyInstantiationResult(hydrateElement(parent.childNodes[i], expanded[i]));
  }
}

function hydrateElement(root: ChildNode, element: VElementOrPrimitive): InstantiationResult {
  if (typeof element !== 'object') {
    return {
      root: new Text(String(element)),
      sideEffects: [],
      unboundEventss: [],
    };
  }

  if (element.element === FRAGMENT_TAG) {
    throw new Error('Not supposed to get fragments here');
  }

  if (!(root instanceof HTMLElement) && !(root instanceof SVGElement)) {
    throw new Error("Cannot hydrate non-element root");
  }
  if (root.tagName.toUpperCase() !== element.element.toUpperCase()) {
    throw new Error(
        `Mismatched tag type: ${root.tagName} != ${element.element}`);
  }
  const children = expandFragments(element.children);
  if (root.childNodes.length !== children.length) {
    throw new Error(
        `Mismatched child count: ${root.childNodes.length} != ${children.length}`);
  }

  vElementsToNodes.set(element, root);
  let maybeSpec: AnyBoundController<HTMLElement|SVGElement>|undefined;
  let unboundEventss: Array<[HTMLElement|SVGElement, UnboundEvents]> = [];

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

  for (let i = 0; i < children.length; ++i) {
    const childResult = hydrateElement(root.childNodes[i], children[i]);
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
      button: Properties<HTMLButtonElement>;
      canvas: Properties<HTMLCanvasElement>;
      div: Properties<HTMLDivElement>;
      footer: Properties<HTMLElement>;
      g: GroupProperties;
      header: Properties<HTMLElement>;
      i: Properties<HTMLElement>;
      img: ImageProperties;
      input: InputProperties;
      label: Properties<HTMLElement>;
      line: LineProperties;
      polyline: PolylineProperties;
      section: Properties<HTMLElement>;
      span: Properties<HTMLSpanElement>;
      svg: SVGProperties;
      text: TextProperties;
    }
  }
}

function isCorgiElement(v: unknown): v is CorgiElement {
  return v instanceof CorgiElement;
}

function expandFragments(elements: VElementOrPrimitive[]): VElementOrPrimitive[] {
  const expanded: VElementOrPrimitive[] = [];
  expandFragmentsRecursive(elements, expanded);
  return expanded;
}

function expandFragmentsRecursive(elements: VElementOrPrimitive[], into: VElementOrPrimitive[]): void {
  for (const element of elements) {
    if (typeof element === 'object' && element.element === FRAGMENT_TAG) {
      expandFragmentsRecursive(element.children, into);
    } else {
      into.push(element);
    }
  }
}
