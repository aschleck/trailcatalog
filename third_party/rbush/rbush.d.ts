export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export class RBush<V extends BBox> {
  constructor(maxEntries?: number);
  all(): V[];
  search(bbox: BBox): V[];
  collides(bbox: BBox): boolean;
  load(data: V[]): RBush<V>;
  insert(item: V): RBush<V>;
  clear(): RBush<V>;
  remove(item: V, equalsFn?: (a: V, b: V) => boolean): RBush<V>;
}
