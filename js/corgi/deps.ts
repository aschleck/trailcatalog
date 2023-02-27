import { fetchServiceDeps } from './binder';
import { ServiceDeps } from './service';
import { DepsConstructorsFor } from './types';

export type EmptyDeps = () => {
  services: {}
}

export function fetchGlobalDeps<D extends ServiceDeps>(deps: DepsConstructorsFor<D>): Promise<D> {
  return fetchServiceDeps(deps);
}

type GenericDeps = {[key: string]: {[key: string]: unknown}}

export function merge<A extends GenericDeps, B extends GenericDeps>(a: A, b: B): A & B {
    const merged: Partial<A & B> = {};
    for (const key of Object.keys(a)) {
        merged[key as keyof A] = Object.assign({}, a[key]) as any;
    }
    for (const key of Object.keys(b)) {
        merged[key as keyof B] = Object.assign(merged[key] ?? {}, b[key]) as any;
    }
    return merged as A & B;
}

