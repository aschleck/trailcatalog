package org.trailcatalog.importers.pbf

import com.google.common.truth.Truth.assertThat
import com.google.protobuf.ByteString
import crosby.binary.Osmformat
import org.junit.Test
import org.trailcatalog.models.RelationCategory

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
  fun testEnglishNameLeadsThenName() {
    val relation =
        relationWithTags(
            "alt_name" to "Moskva",
            "official_name:en" to "City of Moscow",
            "name" to "Москва",
            "name:en" to "Moscow")

    assertThat(relation.names.take(2))
        .containsExactly(Name("en", "Moscow"), Name(null, "Москва"))
        .inOrder()
  }

  @Test
  fun testNameLeadsWithoutAnEnglishName() {
    val relation = relationWithTags("alt_name" to "Moskva", "name" to "Москва")

    assertThat(relation.names[0]).isEqualTo(Name(null, "Москва"))
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
  fun testSplitsSemicolonSeparatedValues() {
    val relation =
        relationWithTags("name" to "Sea-Tac", "alt_name" to "Sea-Tac Airport; SEA Airport;")

    assertThat(relation.names)
        .containsExactly(
            Name(null, "Sea-Tac"), Name(null, "Sea-Tac Airport"), Name(null, "SEA Airport"))
  }

  @Test
  fun testNoNames() {
    val relation = relationWithTags("boundary" to "administrative")

    assertThat(relation.name).isEmpty()
    assertThat(relation.names).isEmpty()
  }

  @Test
  fun testAdministrativeBoundaryTakesItsLevel() {
    assertThat(categoryOf("boundary" to "administrative", "admin_level" to "2"))
        .isEqualTo(RelationCategory.BOUNDARY_ADMINISTRATIVE_2)
    assertThat(categoryOf("admin_level" to "4", "boundary" to "administrative"))
        .isEqualTo(RelationCategory.BOUNDARY_ADMINISTRATIVE_4)
  }

  @Test
  fun testOtherBoundariesIgnoreTheirLevel() {
    assertThat(categoryOf("boundary" to "land_area", "admin_level" to "2"))
        .isEqualTo(RelationCategory.BOUNDARY)
  }

  @Test
  fun testBuildingIgnoresItsLevel() {
    assertThat(
            categoryOf("type" to "multipolygon", "building" to "government", "admin_level" to "2"))
        .isEqualTo(RelationCategory.ANY)
  }
}

private fun categoryOf(vararg tags: Pair<String, String>): RelationCategory {
  val (relation, stringTable) = buildRelation(tags)
  return relationCategory(relation, stringTable)
}

private fun relationWithTags(vararg tags: Pair<String, String>): Relation {
  val (relation, stringTable) = buildRelation(tags)
  // The category only decides whether we keep the relation, and these tests are about its names.
  return getRelation(relation, RelationCategory.ROUTE, stringTable)!!
}

private fun buildRelation(
    tags: Array<out Pair<String, String>>
): Pair<Osmformat.Relation, Osmformat.StringTable> {
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
  return Pair(relation.build(), stringTable.build())
}
