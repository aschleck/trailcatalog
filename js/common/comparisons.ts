export function approxEqual(a: number, b: number, epsilon: number): boolean {
  return Math.abs(a - b) < epsilon;
}

export function deepEqual(a: unknown|undefined, b: unknown|undefined): boolean {
  if (a === b) {
    return true;
  } else if (a instanceof Array && b instanceof Array) {
    if (a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; ++i) {
      if (!deepEqual(a[i], b[i])) {
        return false;
      }
    }
    return true;
  } else if (a instanceof Function || b instanceof Function) {
    return a === b;
  } else if (a instanceof Object && b instanceof Object) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) {
      return false;
    }
    for (const key of aKeys) {
      if (!b.hasOwnProperty(key)) {
        return false;
      }
      const aValue = (a as {[k: string]: unknown})[key];
      const bValue = (b as {[k: string]: unknown})[key];
      if (!deepEqual(aValue, bValue)) {
        return false;
      }
    }
    return true;
  }
  return false;
}

