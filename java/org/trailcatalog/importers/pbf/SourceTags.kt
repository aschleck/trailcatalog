package org.trailcatalog.importers.pbf

import com.google.common.reflect.TypeToken
import com.google.protobuf.ByteString
import crosby.binary.Osmformat
import crosby.binary.Osmformat.PrimitiveBlock
import crosby.binary.Osmformat.StringTable
import org.trailcatalog.importers.pipeline.PTransformer
import org.trailcatalog.importers.pipeline.collections.Emitter
import org.trailcatalog.models.PointCategory
import org.trailcatalog.models.RelationCategory
import org.trailcatalog.models.WayCategory

// Keep in sync with the source_type comment in trailcatalog/migrations/4_source_tags.toml.
enum class SourceType(val id: Int) {
  NODE(0),
  WAY(1),
  RELATION(2),
}

/** The tags of one element as a JSON object, and its version when the file carries one. */
data class SourceTags(val type: SourceType, val id: Long, val version: Int?, val tagsJson: String)

/** Returns the tags of a node with [category] if it becomes a point, or null. */
fun nodeSourceTags(
    id: Long,
    category: PointCategory,
    kvs: List<Int>,
    version: Int?,
    stringTable: StringTable): SourceTags? {
  if (category == PointCategory.ANY) {
    return null
  }
  val json = tagsToJson(kvs.size / 2, { kvs[2 * it] }, { kvs[2 * it + 1] }, stringTable)
  return SourceTags(SourceType.NODE, id, version, json)
}

/** Extracts the tags of the ways that become paths or points. See also DumpPaths. */
class ExtractWayTags
  : PTransformer<PrimitiveBlock, SourceTags>(TypeToken.of(SourceTags::class.java)) {

  override fun act(input: PrimitiveBlock, emitter: Emitter<SourceTags>) {
    for (group in input.primitivegroupList) {
      for (way in group.waysList) {
        if (wayCategory(way, input.stringtable) != WayCategory.ANY
            || wayPointCategory(wayKvs(way), wayRefs(way), input.stringtable)
                != PointCategory.ANY) {
          val json =
              tagsToJson(way.keysCount, way::getKeys, way::getVals, input.stringtable)
          val version = if (way.hasInfo()) way.info.version else null
          emitter.emit(SourceTags(SourceType.WAY, way.id, version, json))
        }
      }
    }
  }
}

/**
 * Returns the tags of a relation with [category] if we keep it, or null. Some of these never become
 * a boundary or a trail, which costs a few rows and nothing else.
 */
fun relationSourceTags(
    relation: Osmformat.Relation,
    category: RelationCategory,
    stringTable: StringTable): SourceTags? {
  if (category == RelationCategory.ANY) {
    return null
  }
  val json = tagsToJson(relation.keysCount, relation::getKeys, relation::getVals, stringTable)
  val version = if (relation.hasInfo()) relation.info.version else null
  return SourceTags(SourceType.RELATION, relation.id, version, json)
}

private fun tagsToJson(
    count: Int, keyAt: (Int) -> Int, valueAt: (Int) -> Int, stringTable: StringTable): String {
  val json = StringBuilder("{")
  for (i in 0 until count) {
    if (i > 0) {
      json.append(',')
    }
    appendJsonString(stringTable.getS(keyAt(i)), json)
    json.append(':')
    appendJsonString(stringTable.getS(valueAt(i)), json)
  }
  return json.append('}').toString()
}

// https://www.rfc-editor.org/rfc/rfc8259#section-7
private fun appendJsonString(bytes: ByteString, json: StringBuilder) {
  json.append('"')
  for (c in bytes.toStringUtf8()) {
    when {
      c == '"' -> json.append("\\\"")
      c == '\\' -> json.append("\\\\")
      c < ' ' -> json.append("\\u%04x".format(c.code))
      else -> json.append(c)
    }
  }
  json.append('"')
}
