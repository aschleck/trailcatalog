import { checkArgument, checkExists } from 'js/common/asserts';

import { Properties } from './elements';

export const Fragment = Symbol();

type Handle = {__brand: 'Handle'} & {
  id: number;
};

interface VElement {
  tag: string|(typeof Fragment);
  children: VElementOrPrimitive[];
  handle: Handle;
  props: Properties;
}

type VElementOrPrimitive = VElement|number|string;

type ElementFactory = (
  props: Properties,
  state: unknown|undefined,
  updateState: (newState: unknown) => void) => VElementOrPrimitive;

// Physical elements track the actual DOM elements that were created based upon a virtual element.
interface PhysicalElement {
  parent: Element;
  self: Node|undefined; // undefined in the case of a fragment element
  placeholder: Node|undefined; // set in empty fragments
  childHandles: Handle[];
}

export function createVirtualElement(
    element: keyof HTMLElementTagNameMap|ElementFactory|(typeof Fragment),
    props: Properties|null,
    ...children: VElementOrPrimitive[]): VElementOrPrimitive {
  const handle = createHandle();
  if (element instanceof Function) {
    const updateState = (newState: unknown) => {
      // TODO: check if still in DOM?
      const result = maybeWrapPrimitive(element({children, ...props}, newState, updateState));
      result.handle = handle;
      updateElement(result);
    };

    const result =
        maybeWrapPrimitive(
            element({
              children,
              ...props,
            },
            undefined,
            updateState));
    result.handle = handle;
    return result;
  } else {
    return {
      tag: element,
      children,
      handle,
      props: props ?? {},
    };
  }
}

export function appendElement(parent: Element, child: VElementOrPrimitive): void {
  appendChildrenToRoot([child], [maybeCreateHandle(child)], parent);
}

export function hydrateElement(parent: Element, to: VElementOrPrimitive): void {
  const children = [...parent.childNodes];
  checkArgument(children.length < 2, 'Cannot have more than one child');
  if (children.length === 0) {
    parent.appendChild(new Text(''));
  }

  hydrateElementRecursively(to, maybeCreateHandle(to), parent, /** left= */ undefined);
}

function hydrateElementRecursively(
    element: VElementOrPrimitive, handle: Handle, parent: Element, left: Node|undefined): {
      childHandles: Handle[];
      last: Node;
    } {
  if (!(element instanceof Object)) {
    let node;
    if (element === '') {
      node = new Text('');
      parent.insertBefore(node, left?.nextSibling ?? null);
    } else {
      node = checkExists(left?.nextSibling ?? parent.childNodes[0]);
      checkArgument(node instanceof Text, 'Node should be text');
      const need = String(element);
      const current = node.textContent ?? '';
      checkArgument(current.startsWith(need), 'Text should match');
      if (current.length > need.length && current.startsWith(need)) {
        const actual = new Text(need);
        parent.insertBefore(actual, node);
        node.textContent = current.substring(need.length);
        node = actual;
      }
    }

    createdElements.set(
        handle, {
          parent,
          self: node,
          placeholder: undefined,
          childHandles: [],
        });
    return {
      childHandles: [],
      last: node,
    };
  }

  if (element.tag === Fragment) {
    const childHandles = [];
    let childLeft = left;
    for (const child of element.children) {
      const handle = maybeCreateHandle(child);
      const r = hydrateElementRecursively(child, handle, parent, childLeft);
      childHandles.push(handle);
      childLeft = r.last ?? childLeft;
    }

    const placeholder = new Text('');
    if (childHandles.length === 0) {
      parent.insertBefore(placeholder, left?.nextSibling ?? null);
      childLeft = placeholder;
    }

    createdElements.set(
        handle, {
          parent,
          self: undefined,
          placeholder,
          childHandles,
        });
    return {
      childHandles,
      last: checkExists(childLeft),
    };
  } else {
    const node = checkExists(left?.nextSibling ?? parent.childNodes[0]) as Element;
    const childHandles = [];
    let childLeft = undefined;
    for (const child of element.children) {
      const handle = maybeCreateHandle(child);
      const r = hydrateElementRecursively(child, handle, node, childLeft);
      childHandles.push(handle);
      childLeft = r.last ?? childLeft;
    }

    createdElements.set(
        handle, {
          parent,
          self: node,
          placeholder: undefined,
          childHandles,
        });
    return {
      childHandles,
      last: node,
    };
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

const createdElements = new WeakMap<Handle, PhysicalElement>();

function* createElement(element: VElementOrPrimitive, handle: Handle, parent: Element):
    Generator<Node, void, void> {
  if (!(element instanceof Object)) {
    const node = new Text(String(element));
    createdElements.set(
        handle, {
          parent,
          self: node,
          placeholder: undefined,
          childHandles: [],
        });
    yield node;
    return;
  }

  const childHandles = [];
  for (const child of element.children) {
    childHandles.push(maybeCreateHandle(child));
  }

  if (element.tag === Fragment) {
    const created = [];
    for (let i = 0; i < element.children.length; ++i) {
      const child = element.children[i];
      const handle = childHandles[i];
      for (const r of createElement(child, handle, parent)) {
        created.push(r);
      }
    }
    let placeholder = new Text('');
    createdElements.set(
        handle, {
          parent,
          self: undefined,
          placeholder,
          childHandles,
        });
    if (childHandles.length === 0) {
      yield placeholder;
    } else {
      for (const child of created) {
        yield child;
      }
    }
  } else {
    const namespace = TAG_TO_NAMESPACE.get(element.tag) ?? 'http://www.w3.org/1999/xhtml';
    const root = document.createElementNS(namespace, element.tag);
    appendChildrenToRoot(element.children, childHandles, root);
    patchProperties(root, element.props);
    createdElements.set(
        handle, {
          parent,
          self: root,
          placeholder: undefined,
          childHandles,
        });
    yield root;
  }
}

function appendChildrenToRoot(
    children: VElementOrPrimitive[], childHandles: Handle[], root: Element) {
  checkArgument(children.length === childHandles.length, 'Mismatched child elements and handles');
  for (let i = 0; i < children.length; ++i) {
    const child = children[i];
    const handle = childHandles[i];
    for (const result of createElement(child, handle, root)) {
      root.append(result);
    }
  }
}

function updateElement(element: VElement) {
  const physical = checkExists(createdElements.get(element.handle));

  // Check if this was and remains a fragment
  if (physical.self === undefined && element.tag === Fragment) {
    const placeholder = physical.placeholder;
    const {childHandles} =
        patchChildren(
            physical.parent, physical.childHandles, element.children, placeholder);
    createdElements.set(
        element.handle, {
          parent: physical.parent,
          self: undefined,
          placeholder,
          childHandles,
        });
    return;
  }

  // Check if this is converting to or from a fragment or if the tags don't line up
  if (physical.self === undefined || element.tag === Fragment) {
    const {childHandles, last} =
        patchChildren(
            physical.parent,
            physical.self ? [element.handle] : physical.childHandles,
            [element],
            physical.placeholder);
    createdElements.set(
        element.handle, {
          parent: physical.parent,
          self: element.tag === Fragment ? undefined : last,
          placeholder: undefined,
          childHandles,
        });
    return;
  }

  patchNode(physical, element);
}

function patchChildren(
    parent: Element, was: Handle[], is: VElementOrPrimitive[], placeholder: Node|undefined): {
      childHandles: Handle[];
      last: Node|undefined;
    } {
  const newHandles = [];
  let last;
  for (let i = 0; i < Math.min(is.length, was.length); ++i) {
    const wasElement = checkExists(createdElements.get(was[i]));
    const isElement = is[i];

    if (wasElement.self === undefined) {
      newHandles.push(maybeCreateHandle(isElement));
      last =
          patchChildren(parent, wasElement.childHandles, [isElement], wasElement.placeholder)?.last
                ?? last;
    } else if (!(isElement instanceof Object)) {
      const handle = createHandle();
      const replacements = [...createElement(isElement, handle, parent)];
      const sibling = wasElement.self.nextSibling;
      parent.replaceChild(replacements[0], wasElement.self);
      replacements.slice(1).forEach(r => {parent.insertBefore(r, sibling)});
      newHandles.push(handle);
      last = replacements[replacements.length - 1];
    } else {
      newHandles.push(maybeCreateHandle(isElement));
      last = patchNode(wasElement, isElement) ?? last;
    }
  }

  const next = last?.nextSibling ?? placeholder ?? null;
  for (let i = was.length; i < is.length; ++i) {
    const isElement = is[i];
    const handle = maybeCreateHandle(isElement);
    const adding = [...createElement(isElement, handle, parent)];
    adding.forEach(a => {parent.insertBefore(a, next)});
    newHandles.push(handle);
    last = adding[adding.length - 1];
  }

  if (placeholder && was.length < is.length && was.length === 0) {
    parent.removeChild(placeholder);
  }

  for (let i = is.length; i < was.length; ++i) {
    const wasElement = checkExists(createdElements.get(was[i]));

    if (wasElement.self === undefined) {
      patchChildren(parent, wasElement.childHandles, [], placeholder);
    } else {
      if (placeholder) {
        parent.insertBefore(placeholder, wasElement.self);
      }
      parent.removeChild(wasElement.self);
    }
  }

  return {
    childHandles: newHandles,
    last,
  };
}

function patchNode(physical: PhysicalElement, to: VElement): Node|undefined {
  const self = checkExists(physical.self, 'patchNode cannot patch fragments');

  if (!(self instanceof Element) || to.tag !== self.tagName.toLowerCase()) {
    const parent = physical.parent;
    const replacements = [...createElement(to, to.handle, parent)];
    if (replacements.length === 0) {
      parent.removeChild(self);
      return undefined;
    }
    const sibling = self.nextSibling;
    parent.replaceChild(replacements[0], self);
    replacements.slice(1).forEach(r => {parent.insertBefore(r, sibling)});
    return replacements[replacements.length - 1];
  }

  patchProperties(self, to.props);
  const {childHandles} = patchChildren(self, physical.childHandles, to.children, undefined);
  physical.childHandles = childHandles;

  return self;
}

function patchProperties(element: Element, props: Properties) {
  // TODO: logic to remove old attributes
  for (const [key, value] of Object.entries(props)) {
    if (key === 'className') {
      element.className = value;
    } else {
      element.setAttribute(key, value);
    }
  }
}

let nextElementId = 0;

function createHandle(): Handle {
  return {id: ++nextElementId} as Handle;
}

function maybeCreateHandle(element: VElementOrPrimitive): Handle {
  if (element instanceof Object) {
    return element.handle;
  } else {
    return createHandle();
  }
}

function maybeWrapPrimitive(element: VElementOrPrimitive): VElement {
  if (element instanceof Object) {
    return element;
  } else {
    return {
      tag: Fragment,
      children: [element],
      handle: createHandle(),
      props: {},
    };
  }
}

