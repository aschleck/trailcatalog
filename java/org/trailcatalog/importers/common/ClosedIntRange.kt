package org.trailcatalog.importers.common

import org.postgresql.util.PGobject

data class ClosedIntRange(val low: Int, val high: Int) : PGobject() {

  init {
    type = "int4range"
    value = "[${low}, ${high}]"
  }
}

fun PGobject.toClosedIntRange(): ClosedIntRange {
  if (type != "int4range") {
    throw IllegalStateException("Cannot call toClosedIntRange on ${type}")
  }
  val items = value!!.split(",")
  if (items.size != 2) {
    throw IllegalStateException("Not a valid range: ${value}")
  }
  // Postgres normalizes [0, 1] to [0, 2) which works because this is on ints.
  if (items[0][0] != '[' || items[1][items[1].length - 1] != ')') {
    throw IllegalStateException("Range is not closed: ${value}")
  }
  return ClosedIntRange(
      items[0].substring(1).toInt(), items[1].substring(0, items[1].length - 1).toInt() - 1)
}