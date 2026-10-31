package org.trailcatalog.models

fun main() {
  println("export const ENUM_SIZE = ${ENUM_SIZE};")
  println("export const CLIMB_THRESHOLD_METERS = ${CLIMB_THRESHOLD_METERS};")
  println("export const ELEVATION_MAX_ZOOM = ${ELEVATION_MAX_ZOOM};")

  println("""
export function aDescendsB(a: number, b: number): boolean {
  let cursor = a;
  while (b < cursor) {
    cursor = Math.floor((cursor - 1) / ENUM_SIZE);
  }
  return b === cursor;
}
""")

  println("""
export function getPointSource(id: bigint): {type: 'node'|'relation'|'way'; id: bigint} {
  if (id >= ${RELATION_POINT_ID_OFFSET}n) {
    return {type: 'relation', id: id - ${RELATION_POINT_ID_OFFSET}n};
  }
  return {type: (id & 1n) === 0n ? 'node' : 'way', id: id >> 1n};
}

export function getPathSourceWay(pathId: bigint): bigint {
  return pathId >> 1n;
}

export function getBoundarySource(id: bigint): {type: 'node'|'relation'|'way'; id: bigint} {
  if (id >= ${NODE_SITE_ID_OFFSET}n) {
    return {type: 'node', id: id - ${NODE_SITE_ID_OFFSET}n};
  } else if (id >= ${WAY_SITE_ID_OFFSET}n) {
    return {type: 'way', id: id - ${WAY_SITE_ID_OFFSET}n};
  } else {
    return {type: 'relation', id};
  }
}
""")

  println("export enum PointCategory {")
  for (c in PointCategory.values()) {
    println("  ${c} = ${c.id},")
  }
  println("}")

  println("export enum RelationCategory {")
  for (c in RelationCategory.values()) {
    println("  ${c} = ${c.id},")
  }
  println("}")

  println("export const SEARCHABLE_POINT_LABELS = new Map<number, string>([")
  for ((c, label) in SEARCHABLE_POINT_LABELS) {
    println("  [PointCategory.${c}, '${label}'],")
  }
  println("]);")

  println("export const NATIONAL_PARK_CATEGORIES = new Set<number>([")
  for (c in NATIONAL_PARK_CATEGORIES) {
    println("  RelationCategory.${c},")
  }
  println("]);")

  println("export enum WayCategory {")
  for (c in WayCategory.values()) {
    println("  ${c} = ${c.id},")
  }
  println("}")

  println("export const PATH_TRAITS = [")
  for (t in PathTrait.values()) {
    println("  {key: '${t.key}', shift: ${t.shift}, mask: ${t.mask}},")
  }
  println("];")

  println("""
export function unpackPathTraits(traits: number, data: {[key: string]: unknown}): void {
  for (const {key, shift, mask} of PATH_TRAITS) {
    data[key] = (traits >> shift) & mask;
  }
}
""")
}
