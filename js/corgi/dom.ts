export type SupportedElement = HTMLElement|SVGElement;

export function elementFinder(
    root: SupportedElement,
    filter: (element: Element) => boolean,
    continuer: (element: Element) => boolean): SupportedElement[] {
  const append = function(array: SupportedElement[], children: HTMLCollection) {
    for (let i = 0; i < children.length; ++i) {
      array.push(children[i] as SupportedElement);
    }
  };

  const selected: SupportedElement[] = [];
  const frontier: SupportedElement[] = [];
  append(frontier, root.children);
  while (frontier.length > 0) {
    const current = <SupportedElement>(frontier.shift());
    if (filter(current)) {
      selected.push(current);
    }
    if (continuer(current)) {
      append(frontier, current.children);
    }
  }
  return selected;
}

export function parentFinder(
    element: SupportedElement, matcher: (element: SupportedElement) => boolean):
        SupportedElement|undefined {
  let target = element;
  while (!matcher(target)) {
    target = target.parentElement as SupportedElement;
  }
  return target ?? undefined;
}