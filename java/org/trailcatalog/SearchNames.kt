package org.trailcatalog

import java.sql.PreparedStatement

// Boundary areas run from around 1e6 square meters for a village to 1.7e14 for Russia, so eight
// decades, and at 0.005 per decade above 1e6 the bonus tops out near 0.04.
// => Moscow, Russia is 2.5e9, so 0.005 * (9.40 - 6) = 0.017
// => Moscow, Idaho is 1.8e7, so 0.005 * (7.26 - 6) = 0.006
// The 0.011 between them beats the 0.007 the substring branch puts between "Moscow" and "Moscow
// Oblast", so a query for Moscow reaches the city, then the oblast, then Idaho. The 0.04 ceiling
// stays inside the similarity branch's 0 to 0.8 spread, so a big boundary never outranks a better
// name.
const val BOUNDARY_AREA_BONUS = "0.005 * GREATEST(LOG(GREATEST(b.area_meters2, 1)) - 6, 0)"

// ILIKE reads % and _ as wildcards and \ as their escape.
fun sanitizeSearchQuery(query: String): String {
  return query.replace(Regex("[%_\\\\]"), "").trim()
}

// Scores group twice. MAX over the two branches for one name, because a whole word match drives
// strict_word_similarity to 1 and the branch to 0, which would throw away the substring branch's
// preference for the shorter of two names that both contain the query. Then DISTINCT ON keeps an
// entity's best name, which is also the one we report it matched.
//
// pg_trgm is installed in public, which trails.lat's reshape schema doesn't search.
fun bestNames(table: String, cutoff: Double): String {
  return """
      SELECT DISTINCT ON (id) id, name, score
      FROM (
        SELECT id, name, MAX(score) AS score
        FROM (
          SELECT id, name, length(name) / 1000. AS score
          FROM $table
          WHERE name ILIKE '%' || ? || '%' AND epoch = ?
          UNION ALL
          SELECT id, name, 1 - public.strict_word_similarity(?, name) AS score
          FROM $table
          WHERE ? OPERATOR(public.<<%) name AND epoch = ?
        ) n
        WHERE n.score < $cutoff
        GROUP BY 1, 2
      ) m
      ORDER BY id, score
  """
}

// Sets the parameters bestNames reads, starting at index 1, and returns the next free index.
fun PreparedStatement.bindBestNames(query: String, epoch: Int): Int {
  setString(1, query)
  setInt(2, epoch)
  setString(3, query)
  setString(4, query)
  setInt(5, epoch)
  return 6
}
