export type Vec2 = [number, number];
export type Vec4 = [number, number, number, number];

export function checkExists<V>(v: V|null|undefined): V {
  if (v === null || v === undefined) {
    throw new Error(`Argument is ${v}`);
  }
  return v;
}

