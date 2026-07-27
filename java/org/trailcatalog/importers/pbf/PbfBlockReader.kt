package org.trailcatalog.importers.pbf

import com.google.protobuf.CodedInputStream
import com.google.protobuf.ExtensionRegistry
import crosby.binary.Fileformat
import crosby.binary.Osmformat.DenseNodes
import crosby.binary.Osmformat.Node
import crosby.binary.Osmformat.PrimitiveBlock
import crosby.binary.Osmformat.PrimitiveGroup
import crosby.binary.Osmformat.Relation
import crosby.binary.Osmformat.StringTable
import crosby.binary.Osmformat.Way
import org.trailcatalog.importers.pipeline.PSource
import java.io.InputStream
import java.nio.ByteBuffer
import java.nio.file.Files
import java.nio.file.Path
import java.util.zip.Inflater
import kotlin.io.path.inputStream

class PbfBlockReader(
    private val path: Path,
    private val readNodes: Boolean,
    private val readRelations: Boolean,
    private val readWays: Boolean,
) : PSource<PrimitiveBlock>() {

  override fun estimateCount(): Long {
    return Files.size(path) / estimateElementBytes()
  }

  override fun estimateElementBytes(): Long {
    return 50_000
  }

  override fun read() = sequence {
    path.inputStream().buffered().use { input ->
      while (true) {
        val header = readBlobHeader(input) ?: break
        if (header.type != "OSMData") {
          input.skipNBytes(header.datasize.toLong())
          continue
        }

        val blob = Fileformat.Blob.parseFrom(input.readNBytes(header.datasize))
        val payload = when {
          blob.hasZlibData() -> {
            val inflater = Inflater()
            inflater.setInput(blob.zlibData.toByteArray())
            val decompressed = ByteArray(blob.rawSize)
            val size = inflater.inflate(decompressed)
            if (size != decompressed.size) {
              throw IllegalStateException("Payload size mismatch: $size vs ${decompressed.size}")
            } else {
              CodedInputStream.newInstance(decompressed)
            }
          }
          blob.hasRaw() -> blob.raw.newCodedInput()
          else -> throw AssertionError("Unknown type of blob")
        }
        yield(parseBlock(payload))
      }
    }
  }

  // A blob is a four byte big endian length, a BlobHeader of that length, and then header.datasize
  // bytes of Blob. Returns null at a clean end of file.
  //
  // https://wiki.openstreetmap.org/wiki/PBF_Format#File_format
  private fun readBlobHeader(input: InputStream): Fileformat.BlobHeader? {
    val length = input.readNBytes(4)
    if (length.isEmpty()) {
      return null
    } else if (length.size < 4) {
      throw IllegalStateException("Truncated blob header length: ${length.size} bytes")
    }
    return Fileformat.BlobHeader.parseFrom(
        input.readNBytes(ByteBuffer.wrap(length).int))
  }

  private fun parseBlock(coded: CodedInputStream): PrimitiveBlock {
    val block = PrimitiveBlock.newBuilder()
    var done = false
    while (!done) {
      val tag = coded.readTag()
      when (tag.ushr(3)) {
        0 -> done = true
        PrimitiveBlock.STRINGTABLE_FIELD_NUMBER ->
          block.setStringtable(
              coded.readMessage(StringTable.parser(), ExtensionRegistry.getEmptyRegistry()))
        PrimitiveBlock.PRIMITIVEGROUP_FIELD_NUMBER -> block.addPrimitivegroup(parseGroup(coded))
        PrimitiveBlock.DATE_GRANULARITY_FIELD_NUMBER -> block.setDateGranularity(coded.readInt32())
        PrimitiveBlock.GRANULARITY_FIELD_NUMBER -> block.setGranularity(coded.readInt32())
        PrimitiveBlock.LAT_OFFSET_FIELD_NUMBER -> block.setLatOffset(coded.readInt64())
        PrimitiveBlock.LON_OFFSET_FIELD_NUMBER -> block.setLonOffset(coded.readInt64())
        else -> coded.skipField(tag)
      }
    }
    return block.buildPartial()
  }

  private fun parseGroup(coded: CodedInputStream): PrimitiveGroup {
    val length = coded.readRawVarint32()
    val oldLimit = coded.pushLimit(length)

    val group = PrimitiveGroup.newBuilder()
    var done = false
    while (!done) {
      val tag = coded.readTag()
      val field = tag.ushr(3)
      if (field == 0) {
        done = true
      } else if (readNodes && field == PrimitiveGroup.DENSE_FIELD_NUMBER) {
        group.setDense(coded.readMessage(DenseNodes.parser(), ExtensionRegistry.getEmptyRegistry()))
      } else if (readNodes && field == PrimitiveGroup.NODES_FIELD_NUMBER) {
        group.addNodes(coded.readMessage(Node.parser(), ExtensionRegistry.getEmptyRegistry()))
      } else if (readRelations && field == PrimitiveGroup.RELATIONS_FIELD_NUMBER) {
        group.addRelations(
            coded.readMessage(Relation.parser(), ExtensionRegistry.getEmptyRegistry()))
      } else if (readWays && field == PrimitiveGroup.WAYS_FIELD_NUMBER) {
        group.addWays(coded.readMessage(Way.parser(), ExtensionRegistry.getEmptyRegistry()))
      } else {
        coded.skipField(tag)
      }
    }

    coded.popLimit(oldLimit)
    return group.buildPartial()
  }
}
