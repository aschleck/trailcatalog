type ConstructorReturnType<T> = T extends new (...args: any) => infer R ? R : never;

type Constructed<O> = {[K in keyof O]: ConstructorReturnType<O[K]>};

type ConstructorsFor<T> = {[K in keyof T]: new (...args: any) => T[K]};

export type DepsConstructed<T> = {[K in keyof T]: Constructed<T[K]>};

export type DepsConstructorsFor<T> = Partial<{[K in keyof T]: ConstructorsFor<T[K]>}>;

