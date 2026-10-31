package org.trailcatalog.importers.pbf

import com.google.common.reflect.TypeToken
import com.google.protobuf.ByteString
import crosby.binary.Osmformat
import crosby.binary.Osmformat.PrimitiveBlock
import crosby.binary.Osmformat.Relation.MemberType.NODE
import crosby.binary.Osmformat.Relation.MemberType.RELATION
import crosby.binary.Osmformat.Relation.MemberType.WAY
import crosby.binary.Osmformat.StringTable
import org.trailcatalog.importers.pipeline.PTransformer
import org.trailcatalog.importers.pipeline.collections.Emitter
import org.trailcatalog.models.AREA_RELATION_CATEGORIES
import org.trailcatalog.models.RelationCategory
import org.trailcatalog.proto.RelationMemberFunction
import org.trailcatalog.proto.RelationMemberFunction.INNER
import org.trailcatalog.proto.RelationMemberFunction.OUTER
import org.trailcatalog.proto.RelationSkeleton
import org.trailcatalog.proto.RelationSkeletonMember

/** Returns the relation with [category], or null if we don't keep it. */
fun getRelation(
    relation: Osmformat.Relation,
    category: RelationCategory,
    stringTable: StringTable): Relation? {
  if (category == RelationCategory.ANY) {
    return null
  }

  var name: String? = null
  val names = NameCollector()
  for (i in 0 until relation.keysCount) {
    val key = stringTable.getS(relation.getKeys(i))
    val value = stringTable.getS(relation.getVals(i))
    if (key == NAME_BS) {
      name = value.toStringUtf8()
    }
    names.add(key, value)
  }

  return Relation(
      relation.id,
      category.id,
      name ?: "",
      names.toList(),
      relationToSkeleton(relation, stringTable))
}

/** Gathers the distinct names among an element's tags. */
class NameCollector {

  // Keyed by the name so that a value carried by several tags, like name and name:en on anything
  // in an English speaking country, only becomes one row. A bare key overwrites a suffixed one so
  // that a shared value ends up with no language whichever order the tags arrive in.
  private val languagesByName = LinkedHashMap<String, String?>()
  private var englishName: String? = null
  private var name: String? = null

  fun add(key: ByteString, raw: ByteString) {
    val tagged =
        if (key == IATA_BS || key == ICAO_BS) {
          // An airport's code is what people type to find it.
          Name(null, raw.toStringUtf8())
        } else {
          tagToName(key, raw) ?: return
        }
    // https://wiki.openstreetmap.org/wiki/Semi-colon_value_separator
    for (part in tagged.value.split(';')) {
      val value = part.trim()
      if (value.isEmpty()) {
        continue
      }
      if (tagged.language == null || !languagesByName.containsKey(value)) {
        languagesByName[value] = tagged.language
      }
      if (key == NAME_EN_BS) {
        englishName = englishName ?: value
      } else if (key == NAME_BS) {
        name = name ?: value
      }
    }
  }

  // name:en and then name lead whichever order the tags arrive in, because readable ids take the
  // first name and the site is in English.
  fun toList(): List<Name> {
    val leading = listOfNotNull(englishName, name).distinct()
    val rest = languagesByName.keys.filter { it !in leading }
    return (leading + rest).map { Name(languagesByName[it], it) }
  }
}

fun relationCategory(relation: Osmformat.Relation, stringTable: StringTable): RelationCategory {
  var category = RelationCategory.ANY
  var adminLevel: RelationCategory? = null
  var administrative = false
  var climbing: RelationCategory? = null
  for (i in 0 until relation.keysCount) {
    when (stringTable.getS(relation.getKeys(i))) {
      ADMIN_LEVEL_BS ->
        adminLevel = ADMINISTRATIVE_LEVEL_NAMES[stringTable.getS(relation.getVals(i))]
      BOUNDARY_BS -> {
        val boundary = BOUNDARY_CATEGORY_NAMES[stringTable.getS(relation.getVals(i))]
        administrative = boundary == RelationCategory.BOUNDARY_ADMINISTRATIVE
        category = category.coerceAtLeast(RelationCategory.BOUNDARY).coerceAtLeast(boundary)
      }
      CLIMBING_BS ->
        climbing = CLIMBING_SITE_CATEGORY_NAMES[stringTable.getS(relation.getVals(i))]
      PROTECT_CLASS_BS ->
        category =
            category
                .coerceAtLeast(RelationCategory.BOUNDARY_PROTECTED_AREA)
                .coerceAtLeast(PROTECT_CLASS_NAMES[stringTable.getS(relation.getVals(i))])
      ROUTE_BS ->
        category =
            category
                .coerceAtLeast(RelationCategory.ROUTE)
                .coerceAtLeast(ROUTE_CATEGORY_NAMES[stringTable.getS(relation.getVals(i))])
    }
  }
  // Land area outlines, maritime zones, claims, and buildings like Paul-Löbe-Haus carry admin_level
  // too, and reading it on them makes them countries and states that lead readable ids.
  if (administrative) {
    category = category.coerceAtLeast(adminLevel)
  }
  // A climbing site drawn as a multipolygon has an area of its own like any other boundary, while
  // CreateClimbingSites makes up the area of the rest. See also climbingRelation.
  if (climbing != null && isMultipolygon(relation, stringTable)) {
    category = category.coerceAtLeast(climbing)
  }
  // Only when it's nothing else, because a lake that is also a protected area is already a
  // boundary.
  if (category == RelationCategory.ANY && isMultipolygon(relation, stringTable)) {
    category =
        AREA_RELATION_CATEGORIES[pointCategory(relationKvs(relation), stringTable)] ?: category
  }
  return category
}

/** Returns the tags of [relation] as interleaved key and value string indices. */
fun relationKvs(relation: Osmformat.Relation): List<Int> {
  val kvs = ArrayList<Int>(2 * relation.keysCount)
  for (i in 0 until relation.keysCount) {
    kvs.add(relation.getKeys(i))
    kvs.add(relation.getVals(i))
  }
  return kvs
}

fun isMultipolygon(relation: Osmformat.Relation, stringTable: StringTable): Boolean {
  for (i in 0 until relation.keysCount) {
    if (stringTable.getS(relation.getKeys(i)) == TYPE_BS) {
      return stringTable.getS(relation.getVals(i)) == MULTIPOLYGON_BS
    }
  }
  return false
}

// Matches a language code: a two or three letter primary subtag plus anything hanging off it. The
// point is to reject the tags that describe a name rather than being one, like name:etymology,
// name:signed, and name:left.
//
// This is looser than iD's, which allows only "-" and requires script and region subtags to be
// exactly -Xxxx and -XX. That drops ja_rm, ja_kana, zh_pinyin, and be-tarask, and transliterations
// are the whole reason to read these tags, because they are what someone typing in the Latin
// alphabet has to search with. The cost is that a suffix like ref-foo would pass as a language.
// https://wiki.openstreetmap.org/wiki/Multilingual_names
private val LANGUAGE_CODE = Regex("[a-z]{2,3}([-_][A-Za-z0-9]+)*")

// Returns the name a tag holds, or null if the key is not one of NAME_TAG_KEYS or the value is
// empty.
private fun tagToName(key: ByteString, value: ByteString): Name? {
  // No key in NAME_TAG_KEYS is a prefix of another, so at most one of them can fit.
  val tag =
      NAME_TAG_KEYS.firstOrNull { key == it || isSuffixedWithLanguage(key, it) } ?: return null
  val decoded = value.toStringUtf8()
  if (decoded.isBlank()) {
    return null
  }
  return Name(if (key == tag) null else key.substring(tag.size() + 1).toStringUtf8(), decoded)
}

private fun isSuffixedWithLanguage(key: ByteString, tag: ByteString): Boolean {
  return key.size() > tag.size() + 1
      && key.startsWith(tag)
      && key.byteAt(tag.size()) == ':'.code.toByte()
      && LANGUAGE_CODE.matches(key.substring(tag.size() + 1).toStringUtf8())
}

private val BACKWARD_BS = ByteString.copyFromUtf8("backward")
private val FORWARD_BS = ByteString.copyFromUtf8("forward")
private val INNER_BS = ByteString.copyFromUtf8("inner")
private val OUTER_BS = ByteString.copyFromUtf8("outer")
private val EMPTY_BS = ByteString.copyFromUtf8("")

// Do we care about north/south/east/west?
// This implicitly drops "alternative" which seems good.
fun memberFunction(role: ByteString): RelationMemberFunction? {
  return when (role) {
    BACKWARD_BS -> OUTER
    FORWARD_BS -> OUTER
    INNER_BS -> INNER
    OUTER_BS -> OUTER
    EMPTY_BS -> OUTER
    else -> null
  }
}

fun relationToSkeleton(relation: Osmformat.Relation, stringTable: StringTable): RelationSkeleton {
  var memberId = 0L
  val skeleton = RelationSkeleton.newBuilder()
  for (i in 0 until relation.memidsCount) {
    memberId += relation.getMemids(i)
    val function = memberFunction(stringTable.getS(relation.getRolesSid(i))) ?: continue

    when (relation.getTypes(i)) {
      // TODO(april): think about this more if we add trailhead information
      // NODE -> skeleton.addMembers(RelationSkeletonMember.newBuilder().setNodeId(memberId))
      NODE -> {}
      RELATION ->
        skeleton.addMembers(
            RelationSkeletonMember.newBuilder()
                .setFunction(function)
                .setRelationId(memberId))
      WAY ->
        skeleton.addMembers(
            RelationSkeletonMember.newBuilder()
                .setFunction(function)
                .setWayId(memberId))
      null -> {}
    }
  }
  return skeleton.build()
}
