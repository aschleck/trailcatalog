package lat.trails.importers

import java.io.ByteArrayInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.zip.GZIPInputStream

/** Reads a ustar archive into its files by name. */
fun readTar(tar: ByteArray): Map<String, ByteArray> {
  // Each file is a 512 byte header followed by its data, padded to a multiple of 512 bytes. The
  // header has the name in its first 100 bytes and the size, in octal, at byte 124.
  val files = HashMap<String, ByteArray>()
  var offset = 0
  while (offset + 512 <= tar.size) {
    val name = String(tar, offset, 100, Charsets.US_ASCII).trimEnd('\u0000')
    if (name.isEmpty()) {
      break
    }
    val size = String(tar, offset + 124, 12, Charsets.US_ASCII).trim('\u0000', ' ').toLong(8).toInt()
    files[name] = tar.copyOfRange(offset + 512, offset + 512 + size)
    offset += 512 + (size + 511) / 512 * 512
  }
  return files
}

fun gunzip(bytes: ByteArray): ByteArray =
    GZIPInputStream(ByteArrayInputStream(bytes)).use { it.readAllBytes() }

/** Reads a dBase table into its rows, with each field as trimmed text and empty ones left out. */
fun readDbf(dbf: ByteArray): List<Map<String, String>> {
  // The header has the row count at byte 4, the header length at 8, and the row length at 10. Then
  // come 32 byte field descriptors, starting at byte 32 and ending with a 0x0D byte. Each row starts
  // with a byte that is '*' if the row is deleted, followed by its fixed width fields.
  // https://www.dbase.com/Knowledgebase/INT/db7_file_fmt.htm
  val header = ByteBuffer.wrap(dbf).order(ByteOrder.LITTLE_ENDIAN)
  val rowCount = header.getInt(4)
  val headerLength = header.getShort(8).toInt()
  val rowLength = header.getShort(10).toInt()

  val fields = ArrayList<Pair<String, Int>>()
  var descriptor = 32
  while (dbf[descriptor] != 0x0D.toByte()) {
    val name = String(dbf, descriptor, 11, Charsets.US_ASCII).trimEnd('\u0000')
    fields.add(name to (dbf[descriptor + 16].toInt() and 0xFF))
    descriptor += 32
  }

  val rows = ArrayList<Map<String, String>>(rowCount)
  for (i in 0 until rowCount) {
    var offset = headerLength + i * rowLength
    if (dbf[offset] == '*'.code.toByte()) {
      continue
    }
    offset += 1
    val row = HashMap<String, String>()
    for ((name, length) in fields) {
      // Fields are padded with spaces or NULs, and Kotlin's trim() doesn't remove NULs
      val value = String(dbf, offset, length, Charsets.UTF_8).trim { it <= ' ' }
      if (value.isNotEmpty()) {
        row[name] = value
      }
      offset += length
    }
    rows.add(row)
  }
  return rows
}
