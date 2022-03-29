export interface EventSpec<S> {
  name: string;
}

export type CorgiEvent<ES> = ES extends EventSpec<infer S> ? CustomEvent<S> : never;

export function bind<S>(spec: EventSpec<S>, fn: (event: CustomEvent<S>) => void):
    [EventSpec<S>, (event: CustomEvent<S>) => void] {
  return [spec, fn];
}

export function declareEvent<S>(name: string): EventSpec<S> {
  return {
    name,
  };
}

export function qualifiedName<S>(spec: EventSpec<S>): string {
  return `corgi.${spec.name}`;
}

