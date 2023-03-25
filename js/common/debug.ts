export function debugMode(): boolean {
  return (globalThis as any)._DEBUG;
}
