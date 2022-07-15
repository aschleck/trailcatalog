export function isAnchorContextClick(e: Event): boolean {
  if (!(e instanceof MouseEvent) && !(e instanceof PointerEvent)) {
    return false;
  }
  if (e.type !== 'click') {
    return false;
  }
  if (!(e.currentTarget instanceof HTMLAnchorElement)) {
    return false;
  }
  return e.ctrlKey || e.metaKey;
}
