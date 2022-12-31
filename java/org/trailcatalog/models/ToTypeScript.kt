package org.trailcatalog.models

fun main() {
  println("export const ENUM_SIZE = ${ENUM_SIZE};")

  println("""
export function aDescendsB(a: number, b: number): boolean {
  let cursor = a;
  while (b < cursor) {
    cursor = (cursor - 1) / ENUM_SIZE;
  }
  return b === cursor;
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

  println("export enum WayCategory {")
  for (c in WayCategory.values()) {
    println("  ${c} = ${c.id},")
  }
  println("}")
}
