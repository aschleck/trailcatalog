import {
  setDescription as ssrSetDescription,
  setTitle as ssrSetTitle,
} from 'external/dev_april_corgi+/js/server/ssr_aware';

export const DEFAULT_DESCRIPTION = 'Worldwide hiking, biking, and skiing trails from OpenStreetMap';

export function setDescription(description: string|undefined): void {
  ssrSetDescription(description || DEFAULT_DESCRIPTION);
}

export function setTitle(title: string|undefined): void {
  if (title) {
    ssrSetTitle(`${title} - Trailcatalog`);
  } else {
    ssrSetTitle('Trailcatalog');
  }
}
