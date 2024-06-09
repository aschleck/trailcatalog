import { setTitle as ssrSetTitle } from 'external/dev_april_corgi~/js/server/ssr_aware';

export function setTitle(title: string|undefined): void {
  if (title) {
    ssrSetTitle(`${title} - Trailcatalog`);
  } else {
    ssrSetTitle('Trailcatalog');
  }
}

