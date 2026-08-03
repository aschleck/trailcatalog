package org.trailcatalog.importers.elevation.pmtiles

import com.google.common.cache.CacheBuilder
import com.google.common.cache.CacheLoader
import org.trailcatalog.common.IORuntimeException
import java.io.ByteArrayInputStream
import java.io.Closeable
import java.nio.ByteBuffer
import java.nio.ByteOrder.LITTLE_ENDIAN
import java.nio.channels.FileChannel
import java.nio.file.Path
import java.util.Arrays
import java.util.zip.GZIPInputStream

// https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md

private const val HEADER_BYTES = 127
private val MAGIC = "PMTiles".toByteArray(Charsets.US_ASCII)
private const val VERSION = 3

const val COMPRESSION_NONE = 1
const val COMPRESSION_GZIP = 2

const val TILE_TYPE_MVT = 1
const val TILE_TYPE_PNG = 2
const val TILE_TYPE_JPEG = 3
const val TILE_TYPE_WEBP = 4
const val TILE_TYPE_AVIF = 5

// Every entry in the root of the mapterhorn planet points at a leaf holding 4096 tile entries, so
// a leaf costs around 100 kB of arrays and 64 of them is a few MB. Tiles are ordered along a
// Hilbert curve, so the leaves a trail's tiles land in stay resident while we walk it.
private const val LEAF_CACHE_SIZE = 64L

// The root points at leaves and a leaf can point at another leaf, but no published archive nests
// deeper than that. Bounding the walk means a corrupt directory fails instead of looping.
private const val MAX_DIRECTORY_DEPTH = 3

/** Reads tiles out of a PMTiles v3 archive. Queries are thread safe. */
class PmtilesReader(private val path: Path) : Closeable {

  private val channel = FileChannel.open(path)
  private val leafDirectoryOffset: Long
  private val tileDataOffset: Long
  private val internalCompression: Int
  private val root: Directory

  val tileCompression: Int
  val tileType: Int
  val minZoom: Int
  val maxZoom: Int

  private val leaves =
      CacheBuilder.newBuilder()
          .maximumSize(LEAF_CACHE_SIZE)
          .build(
              object : CacheLoader<DirectoryLocation, Directory>() {
                override fun load(p0: DirectoryLocation): Directory {
                  return decodeDirectory(
                      decompress(
                          readBytes(leafDirectoryOffset + p0.offset, p0.length),
                          internalCompression))
                }
              })

  init {
    val header = ByteBuffer.wrap(readBytes(0, HEADER_BYTES)).order(LITTLE_ENDIAN)
    for (i in MAGIC.indices) {
      if (header.get(i) != MAGIC[i]) {
        throw IllegalArgumentException("${path} is not a PMTiles archive")
      }
    }
    val version = header.get(7).toInt()
    if (version != VERSION) {
      throw IllegalArgumentException("${path} is PMTiles version ${version}, expected ${VERSION}")
    }

    val rootOffset = header.getLong(8)
    val rootLength = header.getLong(16).toInt()
    leafDirectoryOffset = header.getLong(40)
    tileDataOffset = header.getLong(56)
    internalCompression = header.get(97).toInt() and 0xff
    tileCompression = header.get(98).toInt() and 0xff
    tileType = header.get(99).toInt() and 0xff
    minZoom = header.get(100).toInt() and 0xff
    maxZoom = header.get(101).toInt() and 0xff

    root = decodeDirectory(decompress(readBytes(rootOffset, rootLength), internalCompression))
  }

  override fun close() {
    channel.close()
  }

  /** Returns the tile's bytes, or null if the archive has no tile at that address. */
  fun query(z: Int, x: Int, y: Int): ByteArray? {
    val id = zxyToTileId(z, x, y)
    var directory = root
    for (depth in 0 until MAX_DIRECTORY_DEPTH) {
      val entry = directory.find(id)
      if (entry < 0) {
        return null
      }

      if (directory.runLengths[entry] == 0) {
        directory = leaves[DirectoryLocation(directory.offsets[entry], directory.lengths[entry])]
        continue
      }

      if (id >= directory.ids[entry] + directory.runLengths[entry]) {
        return null
      }
      return readBytes(tileDataOffset + directory.offsets[entry], directory.lengths[entry])
    }
    throw IORuntimeException("${path} nests directories more than ${MAX_DIRECTORY_DEPTH} deep")
  }

  private fun readBytes(offset: Long, length: Int): ByteArray {
    val buffer = ByteBuffer.allocate(length)
    var position = offset
    while (buffer.hasRemaining()) {
      val read = channel.read(buffer, position)
      if (read < 0) {
        throw IORuntimeException("${path} ended before ${offset} + ${length}")
      }
      position += read
    }
    return buffer.array()
  }
}

private data class DirectoryLocation(val offset: Long, val length: Int)

private class Directory(
    val ids: LongArray,
    val runLengths: IntArray,
    val lengths: IntArray,
    val offsets: LongArray,
) {

  /** Returns the index of the last entry at or before [id], or -1 if every entry is after it. */
  fun find(id: Long): Int {
    val found = Arrays.binarySearch(ids, id)
    return if (found >= 0) found else -found - 2
  }
}

private fun decodeDirectory(bytes: ByteArray): Directory {
  val varints = Varints(bytes)
  val count = varints.next().toInt()

  val ids = LongArray(count)
  var id = 0L
  for (i in 0 until count) {
    id += varints.next()
    ids[i] = id
  }

  val runLengths = IntArray(count)
  for (i in 0 until count) {
    runLengths[i] = varints.next().toInt()
  }

  val lengths = IntArray(count)
  for (i in 0 until count) {
    lengths[i] = varints.next().toInt()
  }

  // Offsets are stored plus one so that zero can mean the entry sits immediately after the
  // previous one.
  val offsets = LongArray(count)
  for (i in 0 until count) {
    val stored = varints.next()
    offsets[i] =
        if (stored == 0L && i > 0) {
          offsets[i - 1] + lengths[i - 1]
        } else {
          stored - 1
        }
  }

  return Directory(ids, runLengths, lengths, offsets)
}

private fun decompress(bytes: ByteArray, compression: Int): ByteArray {
  return when (compression) {
    COMPRESSION_NONE -> bytes
    COMPRESSION_GZIP -> GZIPInputStream(ByteArrayInputStream(bytes)).use { it.readBytes() }
    else -> throw IllegalArgumentException("Unable to handle compression ${compression}")
  }
}

/** Returns the position of a tile on the Hilbert curve that PMTiles orders tiles along. */
fun zxyToTileId(z: Int, x: Int, y: Int): Long {
  // Zoom z holds 4^z tiles, and the curve numbers whole zooms in order, so the tiles below z sum
  // to (4^z - 1) / 3.
  var id = ((1L shl (2 * z)) - 1) / 3

  var rotatedX = x.toLong()
  var rotatedY = y.toLong()
  var side = (1L shl z) / 2
  while (side > 0) {
    val quadrantX = if ((rotatedX and side) > 0) 1 else 0
    val quadrantY = if ((rotatedY and side) > 0) 1 else 0
    id += side * side * ((3 * quadrantX) xor quadrantY)

    if (quadrantY == 0) {
      if (quadrantX == 1) {
        rotatedX = side - 1 - rotatedX
        rotatedY = side - 1 - rotatedY
      }
      val swap = rotatedX
      rotatedX = rotatedY
      rotatedY = swap
    }

    side /= 2
  }
  return id
}

private class Varints(private val bytes: ByteArray) {

  private var position = 0

  fun next(): Long {
    var value = 0L
    var shift = 0
    while (true) {
      val byte = bytes[position].toLong() and 0xff
      position += 1
      value = value or ((byte and 0x7f) shl shift)
      if (byte < 0x80) {
        return value
      }
      shift += 7
    }
  }
}
