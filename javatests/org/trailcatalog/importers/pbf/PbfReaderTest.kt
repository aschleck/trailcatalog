package org.trailcatalog.importers.pbf

import com.google.common.reflect.TypeToken
import com.google.common.truth.Truth.assertThat
import com.google.protobuf.ByteString
import crosby.binary.Fileformat
import crosby.binary.Osmformat
import crosby.binary.Osmformat.PrimitiveBlock
import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.io.RandomAccessFile
import java.nio.file.Files
import java.nio.file.Path
import java.util.zip.Deflater
import org.junit.Test
import org.trailcatalog.importers.pipeline.PTransformer
import org.trailcatalog.importers.pipeline.Pipeline
import org.trailcatalog.importers.pipeline.collections.Emitter

// Enough blobs that several threads have blocks in flight at once, and more than the reader's
// arrays start out holding.
private const val NODE_BLOBS = 1500
private const val NODES_PER_BLOB = 4

class PbfReaderTest {

  @Test
  fun testReadsInFileOrder() {
    val pbf = writePbf()

    assertThat(read(pbf, nodes = true))
        .containsExactlyElementsIn((1L..NODE_BLOBS * NODES_PER_BLOB).map { "n$it" })
        .inOrder()
    assertThat(read(pbf, ways = true)).containsExactly("w1", "w2").inOrder()
    assertThat(read(pbf, relations = true)).containsExactly("r1")
  }

  // Overwriting the node blobs, headers and all, after the first read means that a later read only
  // succeeds if it never reads them.
  @Test
  fun testLaterReadsSkipBlobsWithoutWantedKinds() {
    val pbf = writePbf()
    assertThat(read(pbf, nodes = true)).hasSize(NODE_BLOBS * NODES_PER_BLOB)

    RandomAccessFile(pbf.path.toFile(), "rw").use { file ->
      for (range in pbf.nodeBlobs) {
        file.seek(range.first)
        file.write(ByteArray((range.last - range.first + 1).toInt()) { 0x55 })
      }
    }

    assertThat(read(pbf, ways = true)).containsExactly("w1", "w2").inOrder()
    assertThat(read(pbf, relations = true)).containsExactly("r1")
  }
}

private class WrittenPbf(val path: Path, val nodeBlobs: List<LongRange>)

private object ElementIds : PTransformer<PrimitiveBlock, String>(TypeToken.of(String::class.java)) {

  override fun act(input: PrimitiveBlock, emitter: Emitter<String>) {
    forEachNode(input) { id, _, _, _ -> emitter.emit("n$id") }
    for (group in input.primitivegroupList) {
      group.waysList.forEach { emitter.emit("w${it.id}") }
      group.relationsList.forEach { emitter.emit("r${it.id}") }
    }
  }
}

private fun read(
    pbf: WrittenPbf,
    nodes: Boolean = false,
    ways: Boolean = false,
    relations: Boolean = false): List<String> {
  val reader =
      PbfReader(
          pbf.path, readNodes = nodes, readRelations = relations, readWays = ways, ElementIds)
  val elements = ArrayList<String>()
  Pipeline(parallelism = 4).read(reader).invoke().forEach { elements.add(it) }
  return elements
}

private fun writePbf(): WrittenPbf {
  val path = Files.createTempFile("pbf-reader-test", ".osm.pbf")
  path.toFile().deleteOnExit()
  val nodeBlobs = ArrayList<LongRange>()
  DataOutputStream(Files.newOutputStream(path)).use { output ->
    writeBlob(output, "OSMHeader", Osmformat.HeaderBlock.newBuilder().build().toByteArray())

    for (blob in 0 until NODE_BLOBS) {
      // Ids are delta coded within a group, so only the first one carries the blob's offset.
      val dense = Osmformat.DenseNodes.newBuilder()
      for (i in 0 until NODES_PER_BLOB) {
        dense.addId(if (i == 0) blob * NODES_PER_BLOB + 1L else 1L).addLat(1).addLon(1)
      }
      nodeBlobs.add(
          writeBlob(
              output, "OSMData", block(Osmformat.PrimitiveGroup.newBuilder().setDense(dense))))
    }

    writeBlob(
        output,
        "OSMData",
        block(
            Osmformat.PrimitiveGroup.newBuilder()
                .addWays(Osmformat.Way.newBuilder().setId(1).addRefs(1).addRefs(1))
                .addWays(Osmformat.Way.newBuilder().setId(2).addRefs(3).addRefs(1))))
    writeBlob(
        output,
        "OSMData",
        block(
            Osmformat.PrimitiveGroup.newBuilder()
                .addRelations(
                    Osmformat.Relation.newBuilder()
                        .setId(1)
                        .addMemids(1)
                        .addRolesSid(0)
                        .addTypes(Osmformat.Relation.MemberType.WAY))))
  }
  return WrittenPbf(path, nodeBlobs)
}

// Index 0 of a PBF string table is always the empty string.
private fun block(group: Osmformat.PrimitiveGroup.Builder): ByteArray {
  return PrimitiveBlock.newBuilder()
      .setStringtable(Osmformat.StringTable.newBuilder().addS(ByteString.EMPTY))
      .addPrimitivegroup(group)
      .build()
      .toByteArray()
}

// Returns where the blob landed in the file, including its header.
private fun writeBlob(output: DataOutputStream, type: String, raw: ByteArray): LongRange {
  val deflater = Deflater()
  deflater.setInput(raw)
  deflater.finish()
  val compressed = ByteArrayOutputStream()
  val buffer = ByteArray(4096)
  while (!deflater.finished()) {
    compressed.write(buffer, 0, deflater.deflate(buffer))
  }
  deflater.end()

  val blob =
      Fileformat.Blob.newBuilder()
          .setRawSize(raw.size)
          .setZlibData(ByteString.copyFrom(compressed.toByteArray()))
          .build()
          .toByteArray()
  val header = Fileformat.BlobHeader.newBuilder().setType(type).setDatasize(blob.size).build()
  val start = output.size().toLong()
  output.writeInt(header.serializedSize)
  header.writeTo(output)
  output.write(blob)
  return start until output.size().toLong()
}
