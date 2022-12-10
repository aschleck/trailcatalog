package org.trailcatalog.importers.basemap

import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pipeline.PMapTransformer
import org.trailcatalog.importers.pipeline.collections.Emitter2
import org.trailcatalog.importers.pipeline.collections.PEntry
import org.trailcatalog.models.RelationCategory
import java.util.Locale
import java.util.regex.Pattern

private val DASH_CHARACTERS = Pattern.compile("[ ]+").toRegex()
private val STRIP_CHARACTERS = Pattern.compile("[,<.>/?;:'\"\\[{\\]}|`~!@#$%^&*()\\-_=+]").toRegex()

class CreateReadableTrailIds :
    PMapTransformer<PEntry<Long, Pair<List<Trail>, List<Boundary>>>, String, Long>(
    "CreateReadableTrailIds", TypeToken.of(String::class.java), TypeToken.of(Long::class.java)) {

  override fun act(
      input: PEntry<Long, Pair<List<Trail>, List<Boundary>>>,
      emitter: Emitter2<String, Long>) {
    var admin2 = "none"
    var admin4 = "none"
    var trail: String? = null
    for (value in input.values) {
      trail = value.first[0].name
      for (boundary in value.second) {
        if (RelationCategory.BOUNDARY_ADMINISTRATIVE_2.isParentOf(boundary.type)) {
          admin2 = boundary.name
        }
        if (RelationCategory.BOUNDARY_ADMINISTRATIVE_4.isParentOf(boundary.type)) {
          admin4 = boundary.name
        }
      }
    }

    if (trail == null) {
      return
    }

    emitter.emit("${toId(admin2)}/${toId(admin4)}/${toId(trail)}", input.key)
  }

  override fun estimateRatio(): Double {
    return 0.1
  }

  private fun toId(name: String): String {
    return name
        .replace(STRIP_CHARACTERS, "")
        .replace(DASH_CHARACTERS, "-")
        .lowercase(Locale.ENGLISH)
  }
}
