import { fetchServiceDeps } from './binder';
import { ServiceDeps } from './service';
import { DepsConstructorsFor } from './types';

export type EmptyDeps = () => {
  services: {}
}

export function fetchGlobalDeps<D extends ServiceDeps>(deps: DepsConstructorsFor<D>): Promise<D> {
  return fetchServiceDeps(deps);
}

