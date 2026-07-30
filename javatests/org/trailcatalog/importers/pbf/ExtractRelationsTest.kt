package org.trailcatalog.importers.pbf

import com.google.common.truth.Truth.assertThat
import com.google.protobuf.ByteString
import crosby.binary.Osmformat
import org.junit.Test

class ExtractRelationsTest {

  @Test
  fun testKeepsEveryLanguage() {
    val relation =
        relationWithTags(
            "name" to "Москва", "name:en" to "Moscow", "name:be-tarask" to "Масква")

    assertThat(relation.name).isEqualTo("Москва")
    assertThat(relation.names)
        .containsExactly(
            Name(null, "Москва"), Name("en", "Moscow"), Name("be-tarask", "Масква"))
  }

  // Transliterations are the reason to read these tags at all, and OSM spells them with an
  // underscore rather than as BCP 47 subtags.
  @Test
  fun testKeepsTransliterations() {
    val relation =
        relationWithTags(
            "name" to "富士山", "name:ja_rm" to "Fuji-san", "name:ja_kana" to "ふじさん")

    assertThat(relation.names)
        .containsExactly(
            Name(null, "富士山"), Name("ja_rm", "Fuji-san"), Name("ja_kana", "ふじさん"))
  }

  @Test
  fun testKeepsUnsuffixedKinds() {
    val relation =
        relationWithTags(
            "name" to "Pacific Crest Trail",
            "short_name" to "PCT",
            "old_name" to "Pacific Crest Trailway")

    assertThat(relation.names)
        .containsExactly(
            Name(null, "Pacific Crest Trail"),
            Name(null, "PCT"),
            Name(null, "Pacific Crest Trailway"))
  }

  @Test
  fun testDropsTagsAboutTheName() {
    val relation =
        relationWithTags(
            "name" to "Denali",
            "name:etymology" to "Koyukon",
            "name:signed" to "no",
            "name:left" to "nothing",
            "old_name:1" to "Mount McKinley")

    assertThat(relation.names).containsExactly(Name(null, "Denali"))
  }

  // The display name has to come from the bare name tag whichever order the tags arrive in, so this
  // puts short_name first.
  @Test
  fun testDisplayNameIgnoresOtherKinds() {
    val relation = relationWithTags("short_name" to "PCT", "name" to "Pacific Crest Trail")

    assertThat(relation.name).isEqualTo("Pacific Crest Trail")
  }

  @Test
  fun testCollapsesRepeatedValueOntoNoLanguage() {
    val relation = relationWithTags("name:en" to "Moscow", "name" to "Moscow")

    assertThat(relation.names).containsExactly(Name(null, "Moscow"))
  }

  @Test
  fun testDropsEmptyValues() {
    val relation = relationWithTags("name" to "Rainier", "alt_name" to "", "name:fr" to " ")

    assertThat(relation.names).containsExactly(Name(null, "Rainier"))
  }

  @Test
  fun testNoNames() {
    val relation = relationWithTags("boundary" to "administrative")

    assertThat(relation.name).isEmpty()
    assertThat(relation.names).isEmpty()
  }
}

private fun relationWithTags(vararg tags: Pair<String, String>): Relation {
  // Index 0 of a PBF string table is always the empty string.
  val strings = ArrayList<String>().also { it.add("") }
  val relation = Osmformat.Relation.newBuilder().setId(1)
  for ((key, value) in tags) {
    strings.add(key)
    relation.addKeys(strings.size - 1)
    strings.add(value)
    relation.addVals(strings.size - 1)
  }

  val stringTable = Osmformat.StringTable.newBuilder()
  strings.forEach { stringTable.addS(ByteString.copyFromUtf8(it)) }
  return getRelation(relation.build(), stringTable.build())
}
