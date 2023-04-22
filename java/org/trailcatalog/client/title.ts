import { setTitle as ssrSetTitle } from 'js/server/ssr_aware';

export function setTitle(title: string|undefined): void {
  if (title) {
    ssrSetTitle(`${title} - Trailcatalog`);
  } else {
    ssrSetTitle('Trailcatalog');
  }
}

