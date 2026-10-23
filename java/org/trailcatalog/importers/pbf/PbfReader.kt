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
import org.trailcatalog.importers.pipeline.PTransformer
import org.trailcatalog.importers.pipeline.collections.Emitter
import java.nio.ByteBuffer
import java.nio.channels.FileChannel
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.zip.Inflater

private const val NODES = 1
private const val WAYS = 2
private const val RELATIONS = 4

// Blocks decoded ahead of the consumer, per thread. Planet blocks hold 8000 elements, so this keeps
// a few hundred thousand extracted objects in memory.
private const val BLOCKS_IN_FLIGHT_PER_THREAD = 4

// By file, where each blob starts and the element kinds it holds. The first read of a file decodes
// every blob to learn this, and later reads seek straight to the blobs holding what they want.
// Planet files run nodes, then ways, then relations, so a way read starts most of the way into the
// file and a relation read only touches its tail. Seeking from blob to blob would not help, because
// a planet blob is around 100 KB and the disk reads through gaps that small anyway.
private val BLOB_INDEX = ConcurrentHashMap<Path, BlobIndex>()

private class BlobIndex(val offsets: LongArray, val kinds: ByteArray)

private val INFLATER: ThreadLocal<Inflater> = ThreadLocal.withInitial { Inflater() }

/**
 * Reads the blocks of a PBF holding the kinds of element asked for and runs [extract] over each
 * one, decoding and extracting on the stage's worker threads. Elements come out in file order.
 */
class PbfReader<T : Any>(
    private val path: Path,
    private val readNodes: Boolean,
    private val readRelations: Boolean,
    private val readWays: Boolean,
    private val extract: PTransformer<PrimitiveBlock, T>,
) : PSource<T>(extract.type) {

  private val wanted =
      (if (readNodes) NODES else 0) or
          (if (readWays) WAYS else 0) or
          (if (readRelations) RELATIONS else 0)

  override fun estimateCount(): Long {
    return Files.size(path) / estimateElementBytes()
  }

  override fun estimateElementBytes(): Long {
    return 50_000
  }

  override fun read() = sequence {
    val known = BLOB_INDEX[path]
    var offsets = LongArray(1024)
    var kinds = ByteArray(1024)
    val threads = resolvedParallelism
    val pool = Executors.newFixedThreadPool(threads) { r -> Thread(r).also { it.isDaemon = true } }
    val pending = ArrayDeque<Future<Decoded<T>>>()
    try {
      FileChannel.open(path).use { channel ->
        var count = 0
        val blobs =
            if (known == null) {
              // Each blob starts where the last one ended.
              generateSequence { channel.position() }.withIndex()
            } else {
              known.kinds.indices
                  .filter { known.kinds[it].toInt() and wanted != 0 }
                  .map { IndexedValue(it, known.offsets[it]) }
                  .asSequence()
            }
        for ((blob, offset) in blobs) {
          channel.position(offset)
          val header = readBlobHeader(channel) ?: break
          if (known == null) {
            count = blob + 1
            if (blob >= offsets.size) {
              offsets = offsets.copyOf(2 * offsets.size)
              kinds = kinds.copyOf(2 * kinds.size)
            }
            offsets[blob] = offset
          }

          if (header.type != "OSMData") {
            channel.position(channel.position() + header.datasize)
            continue
          }

          val bytes = readFully(channel, header.datasize)
          pending.addLast(pool.submit<Decoded<T>> { decode(blob, bytes) })
          if (pending.size >= threads * BLOCKS_IN_FLIGHT_PER_THREAD) {
            val decoded = await(pending.removeFirst())
            if (known == null) {
              kinds[decoded.blob] = decoded.kinds.toByte()
            }
            yieldAll(decoded.elements)
          }
        }

        while (pending.isNotEmpty()) {
          val decoded = await(pending.removeFirst())
          if (known == null) {
            kinds[decoded.blob] = decoded.kinds.toByte()
          }
          yieldAll(decoded.elements)
        }

        if (known == null) {
          BLOB_INDEX[path] = BlobIndex(offsets.copyOf(count), kinds.copyOf(count))
        }
      }
    } finally {
      pool.shutdownNow()
    }
  }

  private fun decode(blob: Int, bytes: ByteArray): Decoded<T> {
    val parsed = Fileformat.Blob.parseFrom(bytes)
    val payload = when {
      parsed.hasZlibData() -> {
        val inflater = INFLATER.get()
        inflater.reset()
        inflater.setInput(parsed.zlibData.toByteArray())
        val decompressed = ByteArray(parsed.rawSize)
        val size = inflater.inflate(decompressed)
        if (size != decompressed.size) {
          throw IllegalStateException("Payload size mismatch: $size vs ${decompressed.size}")
        }
        CodedInputStream.newInstance(decompressed)
      }
      parsed.hasRaw() -> parsed.raw.newCodedInput()
      else -> throw AssertionError("Unknown type of blob")
    }

    val (block, kinds) = parseBlock(payload)
    val elements = ArrayList<T>()
    extract.act(block, object : Emitter<T> {
      override fun emit(v: T) {
        elements.add(v)
      }
    })
    return Decoded(blob, kinds, elements)
  }

  // Returns the block along with the kinds of element it holds, including the ones we skipped.
  private fun parseBlock(coded: CodedInputStream): Pair<PrimitiveBlock, Int> {
    val block = PrimitiveBlock.newBuilder()
    var kinds = 0
    var done = false
    while (!done) {
      val tag = coded.readTag()
      when (tag.ushr(3)) {
        0 -> done = true
        PrimitiveBlock.STRINGTABLE_FIELD_NUMBER ->
          block.setStringtable(
              coded.readMessage(StringTable.parser(), ExtensionRegistry.getEmptyRegistry()))
        PrimitiveBlock.PRIMITIVEGROUP_FIELD_NUMBER -> {
          val (group, groupKinds) = parseGroup(coded)
          block.addPrimitivegroup(group)
          kinds = kinds or groupKinds
        }
        PrimitiveBlock.DATE_GRANULARITY_FIELD_NUMBER -> block.setDateGranularity(coded.readInt32())
        PrimitiveBlock.GRANULARITY_FIELD_NUMBER -> block.setGranularity(coded.readInt32())
        PrimitiveBlock.LAT_OFFSET_FIELD_NUMBER -> block.setLatOffset(coded.readInt64())
        PrimitiveBlock.LON_OFFSET_FIELD_NUMBER -> block.setLonOffset(coded.readInt64())
        else -> coded.skipField(tag)
      }
    }
    return Pair(block.buildPartial(), kinds)
  }

  private fun parseGroup(coded: CodedInputStream): Pair<PrimitiveGroup, Int> {
    val length = coded.readRawVarint32()
    val oldLimit = coded.pushLimit(length)

    val group = PrimitiveGroup.newBuilder()
    var kinds = 0
    var done = false
    while (!done) {
      val tag = coded.readTag()
      when (tag.ushr(3)) {
        0 -> done = true
        PrimitiveGroup.DENSE_FIELD_NUMBER -> {
          kinds = kinds or NODES
          if (readNodes) {
            group.setDense(
                coded.readMessage(DenseNodes.parser(), ExtensionRegistry.getEmptyRegistry()))
          } else {
            coded.skipField(tag)
          }
        }
        PrimitiveGroup.NODES_FIELD_NUMBER -> {
          kinds = kinds or NODES
          if (readNodes) {
            group.addNodes(coded.readMessage(Node.parser(), ExtensionRegistry.getEmptyRegistry()))
          } else {
            coded.skipField(tag)
          }
        }
        PrimitiveGroup.RELATIONS_FIELD_NUMBER -> {
          kinds = kinds or RELATIONS
          if (readRelations) {
            group.addRelations(
                coded.readMessage(Relation.parser(), ExtensionRegistry.getEmptyRegistry()))
          } else {
            coded.skipField(tag)
          }
        }
        PrimitiveGroup.WAYS_FIELD_NUMBER -> {
          kinds = kinds or WAYS
          if (readWays) {
            group.addWays(coded.readMessage(Way.parser(), ExtensionRegistry.getEmptyRegistry()))
          } else {
            coded.skipField(tag)
          }
        }
        else -> coded.skipField(tag)
      }
    }

    coded.popLimit(oldLimit)
    return Pair(group.buildPartial(), kinds)
  }
}

private class Decoded<T>(val blob: Int, val kinds: Int, val elements: List<T>)

private fun <T> await(future: Future<T>): T {
  try {
    return future.get()
  } catch (e: ExecutionException) {
    throw e.cause ?: e
  }
}

// A blob is a four byte big endian length, a BlobHeader of that length, and then header.datasize
// bytes of Blob. Returns null at a clean end of file.
//
// https://wiki.openstreetmap.org/wiki/PBF_Format#File_format
private fun readBlobHeader(channel: FileChannel): Fileformat.BlobHeader? {
  val length = ByteBuffer.allocate(4)
  while (length.hasRemaining() && channel.read(length) >= 0) {}
  if (length.position() == 0) {
    return null
  } else if (length.hasRemaining()) {
    throw IllegalStateException("Truncated blob header length: ${length.position()} bytes")
  }
  return Fileformat.BlobHeader.parseFrom(readFully(channel, length.flip().int))
}

private fun readFully(channel: FileChannel, size: Int): ByteArray {
  val buffer = ByteBuffer.allocate(size)
  while (buffer.hasRemaining()) {
    if (channel.read(buffer) < 0) {
      throw IllegalStateException("Truncated blob: ${buffer.position()} of ${size} bytes")
    }
  }
  return buffer.array()
}
