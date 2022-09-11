package org.trailcatalog.importers.pbf

import com.google.protobuf.CodedInputStream
import com.google.protobuf.ExtensionRegistry
import com.wolt.osm.parallelpbf.blob.BlobInformation
import com.wolt.osm.parallelpbf.blob.BlobReader
import crosby.binary.Fileformat
import crosby.binary.Osmformat.DenseNodes
import crosby.binary.Osmformat.Node
import crosby.binary.Osmformat.PrimitiveBlock
import crosby.binary.Osmformat.PrimitiveGroup
import crosby.binary.Osmformat.Relation
import crosby.binary.Osmformat.StringTable
import crosby.binary.Osmformat.Way
import org.trailcatalog.importers.pipeline.PSource
import java.nio.file.Files
import java.nio.file.Path
import java.util.Optional
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
    val reader = BlobReader(path.inputStream())
    var maybeInformation: Optional<BlobInformation>
    do {
      maybeInformation = reader
          .readBlobHeaderLength()
          .flatMap { length ->
            reader.readBlobHeader(length)
          }
      val maybeBlock =
          maybeInformation
              .flatMap { information ->
                when (information.type) {
                  BlobInformation.TYPE_OSM_DATA -> reader.readBlob(information.size)
                  else -> {
                    reader.skip(information.size)
                    Optional.empty()
                  }
                }
              }
              .map { data ->
                val blob = Fileformat.Blob.parseFrom(data)
                val payload = when {
                  blob.hasZlibData() -> {
                    val inflater = Inflater()
                    inflater.setInput(blob.zlibData.toByteArray())
                    val decompressed = ByteArray(blob.rawSize)
                    val size = inflater.inflate(decompressed)
                    if (size != decompressed.size) {
                      throw IllegalStateException("Payload size mismatch: $size vs ${decompressed.size}")
                    } else {
                      decompressed
                    }
                  }
                  blob.hasRaw() -> blob.raw.toByteArray()
                  else -> throw AssertionError("Unknown type of blob")
                }
                parseBlock(CodedInputStream.newInstance(payload))
              }
      if (maybeBlock.isPresent) {
        yield(maybeBlock.get())
      }
    } while (maybeInformation.isPresent)
  }

  private fun parseBlock(coded: CodedInputStream): PrimitiveBlock {
    val block = PrimitiveBlock.newBuilder()
    var done = false
    while (!done) {
      val tag = coded.readTag()
      when (tag.ushr(3)) {
        0 -> done = true
        PrimitiveBlock.STRINGTABLE_FIELD_NUMBER ->
          if (readRelations || readWays) {
            block.setStringtable(
                coded.readMessage(StringTable.parser(), ExtensionRegistry.getEmptyRegistry()))
          } else {
            coded.skipField(tag)
          }
        PrimitiveBlock.PRIMITIVEGROUP_FIELD_NUMBER -> block.addPrimitivegroup(parseGroup(coded))
        PrimitiveBlock.DATE_GRANULARITY_FIELD_NUMBER -> block.setDateGranularity(coded.readInt32())
        PrimitiveBlock.GRANULARITY_FIELD_NUMBER -> block.setGranularity(coded.readInt32())
        PrimitiveBlock.LAT_OFFSET_FIELD_NUMBER -> block.setLatOffset(coded.readInt64())
        PrimitiveBlock.LON_OFFSET_FIELD_NUMBER -> block.setLonOffset(coded.readInt64())
        else -> coded.skipField(tag)
      }
    }
    return block.build()
  }

  private fun parseGroup(coded: CodedInputStream): PrimitiveGroup {
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
    return group.build()
  }
}
