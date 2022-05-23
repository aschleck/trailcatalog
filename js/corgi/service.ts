export interface ServiceDeps {
  services: {[key: string]: Service<any>};
}

export interface RequestSpec<D extends ServiceDeps> {
  services?: {[k in keyof D['services']]: CtorFor<D['services'][k]>};
}

interface CtorFor<S extends Service<any>> {
  new (response: ServiceResponse<any>): S;
}

export interface ServiceResponse<D extends ServiceDeps> {
  deps: D;
}

export class Service<D extends ServiceDeps> {

  constructor(response: ServiceResponse<D>) {}
}
