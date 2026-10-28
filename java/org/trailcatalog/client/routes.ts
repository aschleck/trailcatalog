import { exists } from 'external/dev_april_corgi+/js/common/asserts';
import { ViewsService } from 'external/dev_april_corgi+/js/corgi/history/views_service';

export interface Routes {
  boundary_detail: {
    id: string;
  };
  go_to_trail: {
    id: string;
  };
  search_results: {};
  trail_detail: {
    trail: string;
  };
}

export const routes: {[k in keyof Routes]: RegExp} = {
  'boundary_detail': /^\/boundary\/(?<id>.+)$/,
  'go_to_trail': /^\/goto\/trail\/(?<id>\d+)$/,
  'search_results': /^\/(search)?$/,
  'trail_detail': /^\/trail\/(?<trail>.+)$/,
} as const;

export function showOverview(
    {camera}: {camera?: {lat: number; lng: number; zoom: number;};},
    views: ViewsService<Routes>):
    void {
  if (camera) {
    views.goTo(`/?lat=${camera.lat}&lng=${camera.lng}&zoom=${camera.zoom}`);
  } else {
    views.goTo('/');
  }
}

export function showSearchResults({boundary, camera, query}: {
  boundary?: bigint,
  camera?: {lat: number, lng: number, zoom: number},
  query?: string,
}, views: ViewsService<Routes>): void {
  const filters = [
    boundary ? `boundary=${boundary}` : undefined,
    camera ? `lat=${camera.lat}&lng=${camera.lng}&zoom=${camera.zoom}` : undefined,
    query ? `query=${encodeURIComponent(query)}` : undefined,
  ].filter(exists);
  views.goTo(`/search?${filters.join('&')}`);
}

// Trails loaded from map tiles only have numeric ids, and /goto/trail looks up the readable one.
export function getTrailHref(trail: {id: bigint|string; readableId?: string}): string {
  return trail.readableId ? `/trail/${trail.readableId}` : `/goto/trail/${trail.id}`;
}

export function showTrail(trail: {id: bigint; readableId?: string}, views: ViewsService<Routes>):
    void {
  views.goTo(getTrailHref(trail));
}
