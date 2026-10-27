package org.trailcatalog.importers.basemap

import com.google.common.reflect.TypeToken
import com.zaxxer.hikari.HikariDataSource
import org.trailcatalog.importers.pbf.Name
import org.trailcatalog.importers.pipeline.PMapTransformer
import org.trailcatalog.importers.pipeline.PSink
import org.trailcatalog.importers.pipeline.collections.Emitter2
import org.trailcatalog.importers.pipeline.collections.PEntry
import org.trailcatalog.importers.pipeline.collections.PMap
import org.trailcatalog.models.RelationCategory.BOUNDARY_ADMINISTRATIVE_1
import org.trailcatalog.models.RelationCategory.BOUNDARY_ADMINISTRATIVE_2
import org.trailcatalog.models.RelationCategory.BOUNDARY_ADMINISTRATIVE_3
import org.trailcatalog.models.RelationCategory.BOUNDARY_ADMINISTRATIVE_4
import java.util.Locale
import java.util.regex.Pattern

// Separators become dashes, so Basel-Stadt keeps its word break and Schweiz/Suisse/Svizzera/Svizra,
// which lists its languages with slashes, doesn't run them together.
private val DASH_CHARACTERS = Pattern.compile("[ /_-]+").toRegex()
private val STRIP_CHARACTERS = Pattern.compile("[,<.>?;:'\"\\[{\\]}|`~!@#$%^&*()=+]").toRegex()

private val COUNTRY_OR_LARGER = listOf(BOUNDARY_ADMINISTRATIVE_1, BOUNDARY_ADMINISTRATIVE_2)
private val STATE_OR_LARGER =
    COUNTRY_OR_LARGER + listOf(BOUNDARY_ADMINISTRATIVE_3, BOUNDARY_ADMINISTRATIVE_4)

fun toReadableId(name: String): String {
  return name
      .replace(STRIP_CHARACTERS, "")
      .replace(DASH_CHARACTERS, "-")
      .lowercase(Locale.ENGLISH)
}

// The first name is name:en when it's tagged and name otherwise, see NameCollector#toList.
fun getReadableName(names: List<Name>, name: String): String {
  return names.firstOrNull()?.value ?: name
}

// The names of the country and state that lead a readable id, so a park reads
// united-states/washington/mount-rainier-national-park. A country or state skips the levels at or
// above its own, because ResolveContainingBoundaries keeps the best candidate of each type even
// without a majority, and so hands Washington the neighboring Idaho as a state.
fun getRegionPrefix(containing: List<Boundary>, ownType: Int): List<String> {
  val prefix = ArrayList<String>()
  if (COUNTRY_OR_LARGER.none { it.isParentOf(ownType) }) {
    getRegionName(containing.filter { BOUNDARY_ADMINISTRATIVE_2.isParentOf(it.type) })
        ?.also { prefix.add(it) }
  }
  if (STATE_OR_LARGER.none { it.isParentOf(ownType) }) {
    getRegionName(containing.filter { BOUNDARY_ADMINISTRATIVE_4.isParentOf(it.type) })
        ?.also { prefix.add(it) }
  }
  return prefix
}

// Disputed territory lies in more than one country, and taking the lowest id keeps a readable id
// from swapping between imports.
private fun getRegionName(boundaries: List<Boundary>): String? {
  return boundaries.minByOrNull { it.id }?.let { getReadableName(it.names, it.name) }
}

class DisambiguateReadableIds :
  PMapTransformer<PEntry<String, Long>, String, Long>(
  "DisambiguateReadableIds", TypeToken.of(String::class.java), TypeToken.of(Long::class.java)) {

  override fun act(input: PEntry<String, Long>, emitter: Emitter2<String, Long>) {
    // The values arrive in whichever order the workers emitted them, so sorting is what keeps a
    // readable id from swapping with a namesake's between imports.
    val ids = input.values.sorted()
    emitter.emit(input.key, ids[0])
    for (i in 1 until ids.size) {
      emitter.emit(input.key + "-${i + 1}", ids[i])
    }
  }
}

class DumpReadableIds(
    private val table: String,
    private val epoch: Int,
    private val hikari: HikariDataSource,
) : PSink<PMap<String, Long>>() {

  override fun write(input: PMap<String, Long>) {
    input.use {
      val stream =
          StringifyingInputStream(input) { entry, csv ->
            // numeric_id,readable_id,epoch
            csv.append(entry.values[0])
            csv.append(",\"")
            csv.append(entry.key)
            csv.append("\",")
            csv.append(epoch)
            csv.append("\n")
          }
      copyStreamToPg(table, stream, hikari)
    }
  }
}
