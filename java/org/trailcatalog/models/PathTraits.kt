package org.trailcatalog.models

/**
 * The tags packed into a path's traits, each at its shift and as wide as its grades need. A grade
 * is its index in grades plus one, so 0 is untagged and the rest compare by difficulty.
 */
enum class PathTrait(val tag: String, val shift: Int, val grades: List<String>) {
  // The most common tags take the low 7 bits, so that a way carrying only those fits in one varint
  // byte. tracktype is on 10.7M ways, then about 900k each for sac_scale and trail_visibility.
  TRACKTYPE("tracktype", 0, listOf("grade1", "grade2", "grade3", "grade4", "grade5")),
  // informal=no is left out because a formal trail draws like an untagged one.
  INFORMAL("informal", 3, listOf("yes")),
  SAC_SCALE(
      "sac_scale",
      4,
      listOf(
          "hiking",
          "mountain_hiking",
          "demanding_mountain_hiking",
          "alpine_hiking",
          "demanding_alpine_hiking",
          "difficult_alpine_hiking")),
  TRAIL_VISIBILITY(
      "trail_visibility",
      7,
      listOf("excellent", "good", "intermediate", "bad", "horrible", "no")),
  PISTE_DIFFICULTY(
      "piste:difficulty",
      10,
      listOf("novice", "easy", "intermediate", "advanced", "expert", "freeride", "extreme")),
  ;

  val key = name.lowercase()
  val mask = Integer.highestOneBit(grades.size) * 2 - 1
}
