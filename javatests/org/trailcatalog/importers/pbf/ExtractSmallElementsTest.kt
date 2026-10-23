package org.trailcatalog.importers.pbf

import com.google.common.truth.Truth.assertThat
import com.google.protobuf.ByteString
import crosby.binary.Osmformat
import org.junit.Test
import org.trailcatalog.importers.pipeline.collections.Emitter

class ExtractSmallElementsTest {

  @Test
  fun testKeepsTagsOfClimbingNode() {
    val elements = extractNode("climbing" to "crag", "name" to "Waldbauer")
    assertThat(elements).hasSize(1)
    assertThat(elements[0].point).isNull()
    assertThat(elements[0].climbing).isNotNull()
    assertThat(elements[0].tags!!.tagsJson).isEqualTo("""{"climbing":"crag","name":"Waldbauer"}""")
  }

  @Test
  fun testKeepsTagsOnceForPointThatIsAlsoClimbing() {
    val elements = extractNode("climbing" to "route_bottom", "sport" to "climbing")
    assertThat(elements).hasSize(1)
    assertThat(elements[0].point).isNotNull()
    assertThat(elements[0].climbing).isNotNull()
    assertThat(elements[0].tags).isNotNull()
  }

  @Test
  fun testKeepsTagsOfClimbingRelation() {
    val elements = extractRelation("climbing" to "area", "name" to "Flatzer Wand")
    assertThat(elements).hasSize(1)
    assertThat(elements[0].relation).isNull()
    assertThat(elements[0].climbing).isNotNull()
    assertThat(elements[0].tags!!.type).isEqualTo(SourceType.RELATION)
  }

  @Test
  fun testSkipsUntrackedNode() {
    assertThat(extractNode("shop" to "bakery")).isEmpty()
  }
}

private fun extractNode(vararg tags: Pair<String, String>): List<SmallElement> {
  val strings = Strings()
  val node = Osmformat.Node.newBuilder().setId(1).setLat(0).setLon(0)
  for ((key, value) in tags) {
    node.addKeys(strings.add(key))
    node.addVals(strings.add(value))
  }
  return extract(strings, Osmformat.PrimitiveGroup.newBuilder().addNodes(node))
}

private fun extractRelation(vararg tags: Pair<String, String>): List<SmallElement> {
  val strings = Strings()
  val relation = Osmformat.Relation.newBuilder().setId(1)
  for ((key, value) in tags) {
    relation.addKeys(strings.add(key))
    relation.addVals(strings.add(value))
  }
  return extract(strings, Osmformat.PrimitiveGroup.newBuilder().addRelations(relation))
}

private class Strings {
  // Index 0 of a PBF string table is always the empty string.
  val table = Osmformat.StringTable.newBuilder().addS(ByteString.EMPTY)

  fun add(s: String): Int {
    table.addS(ByteString.copyFromUtf8(s))
    return table.sCount - 1
  }
}

private fun extract(strings: Strings, group: Osmformat.PrimitiveGroup.Builder): List<SmallElement> {
  val block =
      Osmformat.PrimitiveBlock.newBuilder()
          .setStringtable(strings.table)
          .addPrimitivegroup(group)
          .build()
  val elements = ArrayList<SmallElement>()
  ExtractSmallElements().act(block, object : Emitter<SmallElement> {
    override fun emit(v: SmallElement) {
      elements.add(v)
    }
  })
  return elements
}
