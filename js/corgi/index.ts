import { checkExists } from 'js/common/asserts';
import { deepEqual } from 'js/common/comparisons';

import { AnyBoundController, applyInstantiationResult, applyUpdate as applyBinderUpdate, bindElementToSpec, disposeBoundElementsIn, InstantiationResult, UnboundEvents } from './binder';
import { SupportedElement } from './dom';

export const Fragment = Symbol();
export { bind } from './binder';

export interface Properties {
  children?: VElementOrPrimitive|VElementOrPrimitive[],
  className?: string;
  js?: AnyBoundController;
  style?: string; // TODO(april): this is sad
  tabIndex?: string;
  title?: string;
  unboundEvents?: UnboundEvents;
}

export interface AnchorProperties extends Properties {
  href?: string;
  target?: '_self'|'_blank'|'_parent'|'_top';
}

export interface GroupProperties extends Properties {}

export interface ImageProperties extends Properties {
  alt?: string;
  height?: string;
  src?: string;
  width?: string;
}

export interface InputProperties extends Properties {
  checked?: boolean;
  name?: string;
  placeholder?: string;
  type?: 'checkbox'|'password'|'radio'|'text';
  value?: string;
}

export interface SVGGraphicsProperties extends Properties {
  vector_effect?: 'none'|'non-scaling-stroke'|'non-scaling-size'|'non-rotation'|'fixed-position';
}

export interface CircleProperties extends SVGGraphicsProperties, Properties {
  fill?: string;
  stroke?: string;
  stroke_width?: number|string;
  cx: number|string;
  cy: number|string;
  r: number|string;
}

export interface LineProperties extends SVGGraphicsProperties, Properties {
  stroke?: string;
  stroke_linejoin?: 'arcs'|'bevel'|'miter'|'miter-clip'|'round';
  stroke_width?: number|string;
  x1: number|string;
  y1: number|string;
  x2: number|string;
  y2: number|string;
}

export interface PolylineProperties extends SVGGraphicsProperties, Properties {
  fill?: string;
  stroke?: string;
  stroke_linejoin?: 'arcs'|'bevel'|'miter'|'miter-clip'|'round';
  stroke_width?: number|string;
  points: string;
}

export interface SVGProperties extends Properties {
  height?: number|string;
  viewBox?: string;
  width?: number|string;
}

export interface TextProperties extends SVGGraphicsProperties, Properties {
  dominant_baseline?:
      'auto'|'text-bottom'|'alphabetic'|'ideographic'|'middle'|'central'|'mathematical'|'hanging'
            |'text-top';
  text_anchor?: 'start'|'middle'|'end';
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
  props: Properties;

  factory?: ElementFactory;
  factoryProps?: Properties;
  handle?: VHandle,
  state?: [object|undefined, (newState: object) => void];
  trace?: VElementOrPrimitive[];

  children: VElementOrPrimitive[];
}

export type VElementOrPrimitive = VElement|number|string;

type ElementFactory = (
    props: Properties|null,
    state: unknown,
    updateState: (newState: object) => void,
) => VElement;

interface VContext {
  live: VElementOrPrimitive[];
  reconstructed: number;
  trace: VElementOrPrimitive[];
}

const vElementPath: VContext[] = [];
const vElementsToNodes = new WeakMap<VElement, Node>();
const vHandlesToElements = new WeakMap<VHandle, VElement>();

export function createVirtualElement(
    element: keyof HTMLElementTagNameMap|ElementFactory|(typeof Fragment),
    props: Properties|null,
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

    // It's best to reuse existing elements, because then when parents rerender their children are
    // have the correct props and states and stuff (which saves us work.) If we don't match things
    // up we can have problems, for example parents not realizing that their child inputs have
    // changed and so not clearing them when re-rendering.
    let previousElement;
    if (vElementPath.length > 0) {
      const top = vElementPath[vElementPath.length - 1];
      // This is kind of slow, but hopefully it's okay since this is important.
      for (let i = top.reconstructed; i < top.live.length; ++i) {
        const candidate = top.live[i];
        if (typeof candidate == 'object' && candidate.factory === element) {
          previousElement = candidate;
          top.reconstructed = i + 1;
          break;
        }
      }

      // Optimistic check
      if (
          previousElement
              && deepEqual(props, checkExists(previousElement.factoryProps))
              && deepEqual(expandChildren, previousElement.children)) {
        top.trace.push(previousElement);
        return previousElement;
      }
    }

    let handle;
    let state: object|undefined;
    let updateState;
    if (previousElement) {
      handle = checkExists(previousElement.handle);
      const canonical = vHandlesToElements.get(handle) ?? previousElement;
      state = checkExists(canonical.state)[0];
      updateState = checkExists(canonical.state)[1];

      vElementPath.push({
        live: checkExists(canonical.trace),
        reconstructed: 0,
        trace: [],
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
        live: [],
        reconstructed: 0,
        trace: [],
      });
    }

    let v;
    try {
      v = element(propClone, state, updateState);
      v.trace = vElementPath[vElementPath.length - 1].trace;
    } finally {
      vElementPath.pop();
    }

    v.factory = element;
    v.factoryProps = props;
    v.handle = handle;
    v.state = [state, updateState];

    if (vElementPath.length > 0) {
      vElementPath[vElementPath.length - 1].trace.push(v);
    }

    // Parents keep references to our first element, so never update it if we have a previous.
    if (!previousElement) {
      vHandlesToElements.set(handle, v);
    }

    return v;
  } else if (element === Fragment) {
    return {
      element: FRAGMENT_TAG,
      props,
      children: expandChildren,
      factory: undefined,
      factoryProps: undefined,
      handle: undefined,
      state: undefined,
      trace: undefined,
    };
  } else {
    return {
      element,
      props,
      children: expandChildren,
      factory: undefined,
      factoryProps: undefined,
      handle: undefined,
      state: undefined,
      trace: undefined,
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
    live: checkExists(element.trace),
    reconstructed: 0,
    trace: [],
  });
  let newElement;
  try {
    newElement = element.factory(element.factoryProps ?? null, newState, element.state[1]);
    newElement.trace = vElementPath[0].trace;
  } finally {
    vElementPath.pop();
  }

  newElement.factory = element.factory;
  newElement.factoryProps = element.factoryProps;
  newElement.handle = element.handle;
  newElement.state = element.state;
  updateThroughFragments(element, newElement);
  element.state = [newState, checkExists(element.state)[1]];
}

function updateThroughFragments(from: VElement, to: VElement) {
  if ((from.element === FRAGMENT_TAG) !== (to.element === FRAGMENT_TAG)) {
    throw new Error('Fragment flip-flopping is bad');
  }
  if (from.element === FRAGMENT_TAG) {
    if (from.children.length !== to.children.length) {
      throw new Error('Mismatched child counts');
    }

    for (let i = 0; i < from.children.length; ++i) {
      const was = from.children[i];
      const is = to.children[i];
      if (typeof was !== 'object' || typeof is !== 'object') {
        throw new Error('Cannot update primitive fragment children');
      }

      updateThroughFragments(was, is);
    }
  } else {
    const node = vElementsToNodes.get(from);
    if (!node) {
      console.error('Stale state update, or terrifying bug');
      return;
    }

    const result = applyUpdate(from, to);
    if (node !== result.root) {
      node.parentNode?.replaceChild(result.root, node);
      result.sideEffects.push(() => { disposeBoundElementsIn(node); });
    }

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
      || from.props.js?.disposer.isDisposed
      || from.props.js?.key !== to.props.js?.key
      || from.props.js?.ref !== to.props.js?.ref) {
    const element = createElement(to);
    if (from) {
      vElementsToNodes.set(from, element.root);
      Object.assign(from, to);

      // We reused the element, so remap it.
      if (to.handle) {
        vHandlesToElements.set(to.handle, from);
      }
    }
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

  const oldPropKeys = Object.keys(from.props) as Array<keyof Properties>;
  const newPropKeys = Object.keys(to.props) as Array<keyof Properties>;
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
      } else if ((key as string) === 'value') {
        (node as HTMLInputElement).value = checkExists(to.props[key]);
      } else {
        const canonical = key.replace('_', '-');
        const value = checkExists(to.props[key]);
        if (typeof value === 'boolean') {
          if (value) {
            node.setAttribute(canonical, '');
          }
        } else {
          node.setAttribute(canonical, value);
        }
      }
    }
  }
  for (const key of oldPropKeys) {
    const canonical = key.replace('_', '-');
    if (!to.props.hasOwnProperty(key)) {
      if (key === 'unboundEvents') {
        result.unboundEventss.push([node, {}]);
      } else {
        node.removeAttribute(key === 'className' ? 'class' : canonical);
      }
    } else if (typeof to.props[key] === 'boolean' && !to.props[key]) {
      node.removeAttribute(canonical);
    }
  }

  applyThroughFragments(from.children, to.children, node, 0, [...node.childNodes], result);

  vElementsToNodes.set(from, result.root);
  if (to.handle) {
    vHandlesToElements.set(to.handle, from);
  }
  from.handle = to.handle;
  from.props = to.props;
  from.factory = to.factory;
  from.factoryProps = to.factoryProps;
  from.state = to.state;
  from.trace = to.trace;
  return result;
}

// When applying updates, we need to compare using the fragment tree but never actually create
// fragments in the DOM. So this recursive function processes `node`'s children and moves
// `currentChildIndex` forward as it matches children.
function applyThroughFragments(
    fromChildren: VElementOrPrimitive[],
    toChildren: VElementOrPrimitive[],
    node: SupportedElement,
    currentChildIndex: number,
    oldChildren: ChildNode[],
    result: InstantiationResult,
): number {
  let firstIndex = currentChildIndex;
  for (let i = 0; i < toChildren.length; ++i) {
    const was = fromChildren[i];
    const is = toChildren[i];

    if (was === is) {
      currentChildIndex += countNodes(was);
      continue;
    }

    const wasElement = typeof was === 'object';
    const wasFragment = wasElement && was.element === FRAGMENT_TAG;
    const isElement = typeof is === 'object';
    const isFragment = isElement && is.element === FRAGMENT_TAG;
    fromChildren[i] = was ?? is;

    if ((!was || wasFragment) && isFragment) {
      // Are we creating or changing a fragment?
      currentChildIndex =
          applyThroughFragments(
              wasFragment ? was.children : [],
              is.children,
              node,
              currentChildIndex,
              oldChildren,
              result);
      if (wasElement) {
        if (is.handle) {
          vHandlesToElements.set(is.handle, was);
        }
        was.handle = is.handle;
        was.props = is.props;
        was.factory = is.factory;
        was.factoryProps = is.factoryProps;
        was.state = is.state;
        was.trace = is.trace;
      }
      continue;
    }

    if (wasElement && !wasFragment && isElement && !isFragment) {
      // Important to get the old node before we apply the update or else we'll just fetch the new
      // node.
      const oldNode = vElementsToNodes.get(was);
      const childResult = applyUpdate(was, is);
      if (!oldNode) {
        node.appendChild(childResult.root);
      } else if (oldNode !== childResult.root) {
        node.replaceChild(childResult.root, oldNode);
        result.sideEffects.push(() => { disposeBoundElementsIn(oldNode); });
      }

      currentChildIndex += 1;
      result.sideEffects.push(...childResult.sideEffects);
      result.unboundEventss.push(...childResult.unboundEventss);
    } else {
      // We just clobber data for primitives and problems. Note that if `is` is a fragment then we
      // have to expand it.
      const wasNodes = expandFragments([was]);
      const isNodes = expandFragments([is]);
      for (const expand of isNodes) {
        const childResult = createElement(expand);
        if (currentChildIndex < oldChildren.length) {
          const old = oldChildren[currentChildIndex];
          node.replaceChild(childResult.root, old);
          result.sideEffects.push(() => { disposeBoundElementsIn(old); });
        } else {
          node.appendChild(childResult.root);
        }

        currentChildIndex += 1;
        result.sideEffects.push(...childResult.sideEffects);
        result.unboundEventss.push(...childResult.unboundEventss);
      }
      const afterIs = currentChildIndex;
      for (let i = isNodes.length; i < wasNodes.length; ++i) {
        const old = node.childNodes[afterIs];
        old.remove();
        result.sideEffects.push(() => { disposeBoundElementsIn(old); });
        currentChildIndex += 1;
      }

      if (wasElement && isElement) {
        Object.assign(was, is);
        const node = vElementsToNodes.get(is);
        if (node) {
          vElementsToNodes.set(was, node);
        }
        if (is.handle) {
          vHandlesToElements.set(is.handle, was);
        }
      } else {
        // We need to replace `was` with `is`.
        fromChildren[i] = is;
      }
    }
  }

  // We have to be careful when deleting: we need to delete all elements corresponding to extra
  // oldChildren, but because there may be sibling fragments that need to be applied into the same
  // node after this we have to count the difference.
  const extra =
      fromChildren.slice(toChildren.length)
              .reduce((count: number, child: VElementOrPrimitive) => count + countNodes(child), 0)
          - (currentChildIndex - firstIndex);
  for (let i = 0; i < extra; ++i) {
    const old = oldChildren[currentChildIndex + i];
    old.remove();
    result.sideEffects.push(() => { disposeBoundElementsIn(old); });
  }
  fromChildren.length = toChildren.length;
  return currentChildIndex;
}

function countNodes(element: VElementOrPrimitive): number {
  if (isVElement(element) && element.element === FRAGMENT_TAG) {
    let count = 0;
    for (const child of element.children) {
      count += countNodes(child);
    }
    return count;
  } else {
    return 1;
  }
}

const TAG_TO_NAMESPACE = new Map([
  ['circle', 'http://www.w3.org/2000/svg'],
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
  let maybeSpec: AnyBoundController|undefined;
  let unboundEventss: Array<[HTMLElement|SVGElement, UnboundEvents]> = [];

  const props = element.props;
  for (const [key, value] of Object.entries(props)) {
    const canonical = key.replace('_', '-');
    if (key === 'js') {
      maybeSpec = value;
      root.setAttribute('data-js', '');
      if (value.ref) {
        root.setAttribute('data-js-ref', value.ref);
      }
    } else if (key === 'unboundEvents') {
      if (value) {
        unboundEventss.push([root, value]);
      }
    } else if (key === 'className') {
      root.setAttribute('class', value);
    } else if (typeof value === 'boolean') {
      if (value) {
        root.setAttribute(canonical, '');
      }
    } else {
      root.setAttribute(canonical, value);
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
  let maybeSpec: AnyBoundController|undefined;
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
      aside: Properties;
      button: Properties;
      canvas: Properties;
      circle: CircleProperties;
      div: Properties;
      footer: Properties;
      g: GroupProperties;
      header: Properties;
      i: Properties;
      img: ImageProperties;
      input: InputProperties;
      label: Properties;
      line: LineProperties;
      main: Properties;
      polyline: PolylineProperties;
      section: Properties;
      span: Properties;
      svg: SVGProperties;
      table: Properties;
      tbody: Properties;
      td: Properties;
      text: TextProperties;
      th: Properties;
      thead: Properties;
      tr: Properties;
    }
  }
}

function isCorgiElement(v: unknown): v is CorgiElement {
  return v instanceof CorgiElement;
}

function isVElement(v: VElementOrPrimitive): v is VElement {
  return typeof v === 'object';
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
