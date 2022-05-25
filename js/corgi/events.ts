export interface EventSpec<S> {
  name: string;
}

export type CorgiEvent<ES> = ES extends EventSpec<infer S> ? CustomEvent<S> : never;

export function declareEvent<S>(name: string): EventSpec<S> {
  return {
    name,
  };
}

export function qualifiedName<S>(spec: EventSpec<S>): string {
  return `corgi.${spec.name}`;
}

