package org.trailcatalog.importers.elevation

import org.trailcatalog.importers.elevation.pmtiles.COMPRESSION_GZIP
import org.trailcatalog.importers.elevation.pmtiles.COMPRESSION_NONE
import org.trailcatalog.importers.elevation.pmtiles.TILE_TYPE_WEBP
import org.trailcatalog.importers.elevation.pmtiles.zxyToTileId
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder.LITTLE_ENDIAN
import java.nio.file.Path
import java.util.TreeMap
import java.util.zip.GZIPOutputStream
import kotlin.io.path.writeBytes

private const val HEADER_BYTES = 127

// Writes PMTiles v3 archives from the spec rather than from the reader, so the two have to agree
// for a test to pass.
// https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md
class Archive(private val maxZoom: Int, private val tileType: Int = TILE_TYPE_WEBP) {

  private val tiles = TreeMap<Long, ByteArray>()

  fun put(z: Int, x: Int, y: Int, bytes: ByteArray): Archive {
    tiles[zxyToTileId(z, x, y)] = bytes
    return this
  }

  fun write(path: Path, inLeaves: Boolean = true, elideOffsets: Boolean = true): Path {
    val entries = ArrayList<Entry>()
    var tileOffset = 0L
    for ((id, bytes) in tiles) {
      entries.add(Entry(id, runLength = 1, length = bytes.size, offset = tileOffset))
      tileOffset += bytes.size
    }

    val leaves: ByteArray
    val root: ByteArray
    if (inLeaves) {
      leaves = gzip(encodeDirectory(entries, elideOffsets))
      root =
          gzip(
              encodeDirectory(
                  listOf(Entry(id = 0, runLength = 0, length = leaves.size, offset = 0)),
                  elideOffsets = false))
    } else {
      leaves = ByteArray(0)
      root = gzip(encodeDirectory(entries, elideOffsets))
    }

    val header = ByteBuffer.allocate(HEADER_BYTES).order(LITTLE_ENDIAN)
    header.put("PMTiles".toByteArray(Charsets.US_ASCII))
    header.put(3.toByte())
    header.putLong(8, HEADER_BYTES.toLong())
    header.putLong(16, root.size.toLong())
    header.putLong(24, (HEADER_BYTES + root.size).toLong()) // metadata, which we leave empty
    header.putLong(32, 0)
    header.putLong(40, (HEADER_BYTES + root.size).toLong())
    header.putLong(48, leaves.size.toLong())
    header.putLong(56, (HEADER_BYTES + root.size + leaves.size).toLong())
    header.putLong(64, tileOffset)
    header.putLong(72, tiles.size.toLong())
    header.putLong(80, tiles.size.toLong())
    header.putLong(88, tiles.size.toLong())
    header.put(96, 1.toByte()) // clustered
    header.put(97, COMPRESSION_GZIP.toByte())
    header.put(98, COMPRESSION_NONE.toByte())
    header.put(99, tileType.toByte())
    header.put(100, 0.toByte())
    header.put(101, maxZoom.toByte())

    val out = ByteArrayOutputStream()
    out.write(header.array())
    out.write(root)
    out.write(leaves)
    for (bytes in tiles.values) {
      out.write(bytes)
    }
    path.writeBytes(out.toByteArray())
    return path
  }
}

private data class Entry(val id: Long, val runLength: Int, val length: Int, val offset: Long)

private fun encodeDirectory(entries: List<Entry>, elideOffsets: Boolean): ByteArray {
  val out = ByteArrayOutputStream()
  out.writeVarint(entries.size.toLong())

  var id = 0L
  for (entry in entries) {
    out.writeVarint(entry.id - id)
    id = entry.id
  }
  for (entry in entries) {
    out.writeVarint(entry.runLength.toLong())
  }
  for (entry in entries) {
    out.writeVarint(entry.length.toLong())
  }
  for ((i, entry) in entries.withIndex()) {
    val contiguous = i > 0 && entry.offset == entries[i - 1].offset + entries[i - 1].length
    if (elideOffsets && contiguous) {
      out.writeVarint(0)
    } else {
      out.writeVarint(entry.offset + 1)
    }
  }
  return out.toByteArray()
}

private fun gzip(bytes: ByteArray): ByteArray {
  val out = ByteArrayOutputStream()
  GZIPOutputStream(out).use {
    it.write(bytes)
  }
  return out.toByteArray()
}

private fun ByteArrayOutputStream.writeVarint(value: Long) {
  var remaining = value
  while (remaining >= 0x80) {
    write(((remaining and 0x7f) or 0x80).toInt())
    remaining = remaining ushr 7
  }
  write(remaining.toInt())
}
