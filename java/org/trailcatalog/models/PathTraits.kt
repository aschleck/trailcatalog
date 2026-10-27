package org.trailcatalog.models

/**
 * The tags packed into a path's traits, each at its shift and as wide as its grades need. A grade
 * is its index in grades plus one, so 0 is untagged and the rest compare in the order listed. Each
 * grade lists every value that means it.
 *
 * The first of tags that a way carries decides the grade, even when its value isn't one of the
 * grades, so foot=yes keeps access=no from closing a path to hikers.
 */
enum class PathTrait(val tags: List<String>, val shift: Int, val grades: List<List<String>>) {
  // Ordered by how many path-like ways carry each tag, so that the common ones stay in the low
  // bytes of the varint. tracktype is on 10.2M ways, bicycle and foot on 5.5M and 5.2M, and
  // via_ferrata_scale on 5k.
  TRACKTYPE(
      listOf("tracktype"),
      0,
      listOf(
          listOf("grade1"),
          listOf("grade2"),
          listOf("grade3"),
          listOf("grade4"),
          listOf("grade5"))),
  BICYCLE(listOf("bicycle", "access"), 3, access("dismount")),
  FOOT(listOf("foot", "access"), 5, access()),
  HORSE(listOf("horse", "access"), 7, access()),
  // Whether a rider may only go along the way's nodes or only against them. It binds riders alone
  // because mappers put oneway=yes on downhill bike lines without meaning that nobody can walk up.
  DIRECTION(
      listOf("mtb:oneway", "oneway:bicycle", "oneway"), 9, listOf(listOf("yes"), listOf("-1"))),
  MTB_SCALE(listOf("mtb:scale"), 11, numbered(6)),
  TRAIL_VISIBILITY(
      listOf("trail_visibility"),
      14,
      listOf(
          listOf("excellent"),
          listOf("good"),
          listOf("intermediate"),
          listOf("bad"),
          listOf("horrible"),
          listOf("no"))),
  SAC_SCALE(
      listOf("sac_scale"),
      17,
      listOf(
          listOf("hiking"),
          listOf("mountain_hiking"),
          listOf("demanding_mountain_hiking"),
          listOf("alpine_hiking"),
          listOf("demanding_alpine_hiking"),
          listOf("difficult_alpine_hiking"))),
  // informal=no is left out because a formal trail draws like an untagged one.
  INFORMAL(listOf("informal"), 20, listOf(listOf("yes"))),
  DOG(listOf("dog"), 21, listOf(listOf("no"), listOf("leashed"), listOf("yes", "unleashed"))),
  PISTE_GROOMING(
      listOf("piste:grooming"),
      23,
      listOf(
          listOf("classic"),
          listOf("classic+skating", "classic;skating", "skating"),
          listOf("backcountry"))),
  PISTE_DIFFICULTY(
      listOf("piste:difficulty"),
      25,
      listOf(
          listOf("novice"),
          listOf("easy"),
          listOf("intermediate"),
          listOf("advanced"),
          listOf("expert"),
          listOf("freeride"),
          listOf("extreme"))),
  VIA_FERRATA_SCALE(listOf("via_ferrata_scale"), 28, numbered(6)),
  ;

  val key = name.lowercase()
  val mask = Integer.highestOneBit(grades.size) * 2 - 1
}

/** The categories whose ways carry traits. */
val PATH_TRAIT_CATEGORIES = listOf(WayCategory.PATH, WayCategory.ROAD_TRACK, WayCategory.PISTE)

private fun access(vararg no: String): List<List<String>> {
  return listOf(listOf("no", "private") + no, listOf("yes", "permissive"), listOf("designated"))
}

// The + and - grades fold into their number, because a style or a route never splits them.
private fun numbered(max: Int): List<List<String>> {
  return (0..max).map { listOf("$it", "$it-", "$it+") }
}
