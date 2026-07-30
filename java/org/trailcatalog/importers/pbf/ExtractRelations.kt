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
import org.trailcatalog.models.RelationCategory
import org.trailcatalog.proto.RelationMemberFunction.INNER
import org.trailcatalog.proto.RelationMemberFunction.OUTER
import org.trailcatalog.proto.RelationSkeleton
import org.trailcatalog.proto.RelationSkeletonMember

class ExtractRelations : PTransformer<PrimitiveBlock, Relation>(TypeToken.of(Relation::class.java)) {

  override fun act(input: PrimitiveBlock, emitter: Emitter<Relation>) {
    for (group in input.primitivegroupList) {
      for (relation in group.relationsList) {
        val converted = getRelation(relation, input.stringtable)
        if (converted.type != RelationCategory.ANY.id) {
          emitter.emit(converted)
        }
      }
    }
  }

  override fun estimateRatio(): Double {
    return 0.01
  }
}

fun getRelation(relation: Osmformat.Relation, stringTable: StringTable): Relation {
  var category = RelationCategory.ANY
  var name: String? = null
  // Keyed by the name so that a value carried by several tags, like name and name:en on anything
  // in an English speaking country, only becomes one row. A bare key overwrites a suffixed one so
  // that a shared value ends up with no language whichever order the tags arrive in.
  val languagesByName = LinkedHashMap<String, String?>()
  for (i in 0 until relation.keysCount) {
    val key = stringTable.getS(relation.getKeys(i))
    when (key) {
      ADMIN_LEVEL_BS ->
        category =
            category
                .coerceAtLeast(RelationCategory.BOUNDARY_ADMINISTRATIVE)
                .coerceAtLeast(ADMINISTRATIVE_LEVEL_NAMES[stringTable.getS(relation.getVals(i))])
      BOUNDARY_BS ->
        category =
            category
                .coerceAtLeast(RelationCategory.BOUNDARY)
                .coerceAtLeast(BOUNDARY_CATEGORY_NAMES[stringTable.getS(relation.getVals(i))])
      NAME_BS ->
        name = stringTable.getS(relation.getVals(i)).toStringUtf8()
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

    val tagged = tagToName(key, stringTable.getS(relation.getVals(i))) ?: continue
    if (tagged.language == null || !languagesByName.containsKey(tagged.value)) {
      languagesByName[tagged.value] = tagged.language
    }
  }

  return Relation(
      relation.id,
      category.id,
      name ?: "",
      languagesByName.map { (value, language) -> Name(language, value) },
      relationToSkeleton(relation, stringTable))
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

fun relationToSkeleton(relation: Osmformat.Relation, stringTable: StringTable): RelationSkeleton {
  var memberId = 0L
  val skeleton = RelationSkeleton.newBuilder()
  for (i in 0 until relation.memidsCount) {
    memberId += relation.getMemids(i)
    // Do we care about north/south/east/west?
    // This implicitly drops "alternative" which seems good.
    val function =
        when (stringTable.getS(relation.getRolesSid(i))) {
          BACKWARD_BS -> OUTER
          FORWARD_BS -> OUTER
          INNER_BS -> INNER
          OUTER_BS -> OUTER
          EMPTY_BS -> OUTER
          null -> OUTER
          else -> null
        }

    if (function == null) {
      continue
    }

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
