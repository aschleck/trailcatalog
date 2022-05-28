import { DepsConstructed, DepsConstructorsFor } from './types';

export interface ServiceDeps {
  services: {[key: string]: Service<any>};
}

export type ServiceDepsMethod = () => DepsConstructorsFor<ServiceDeps>;

interface CtorFor<S extends Service<any>> {
  new (response: ServiceResponse<any>): S;
}

export interface ServiceResponse<D extends ServiceDepsMethod> {
  deps: DepsConstructed<ReturnType<D>>;
}

export class Service<D extends ServiceDepsMethod> {

  constructor(response: ServiceResponse<D>) {}
}
