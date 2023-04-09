export function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

export function floatCoalesce(...numbers: Array<string|number|null|undefined>): number {
  for (const x of numbers) {
    if (x === undefined || x === null) {
      continue;
    }
    const n = Number(x);
    if (!isNaN(n)) {
      return n;
    }
  }
  throw new Error('No valid floats');
}

