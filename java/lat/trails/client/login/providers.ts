export type ProviderName = 'apple'|'google'|'osm';

interface ProviderIdentity {
  issuer: string;
  label: string;
  // under /static
  logo: string;
}

// In the order we list them
export const PROVIDER_IDENTITIES: {[name in ProviderName]: ProviderIdentity} = {
  apple: {issuer: 'https://appleid.apple.com', label: 'Apple', logo: 'apple_logo.svg'},
  google: {issuer: 'https://accounts.google.com', label: 'Google', logo: 'google_logo.svg'},
  osm: {issuer: 'https://www.openstreetmap.org', label: 'OpenStreetMap', logo: 'osm_logo.svg'},
};

declare global {
  interface Window {
    // Set by the frontend's page template
    LOGIN_PROVIDERS?: ProviderName[];
  }
}

/** Returns the providers the server has credentials for. */
export function getConfiguredProviders(): ProviderName[] {
  return window.LOGIN_PROVIDERS ?? [];
}

export function getProviderLabel(issuer: string): string {
  return Object.values(PROVIDER_IDENTITIES).find(p => p.issuer === issuer)?.label ?? issuer;
}
