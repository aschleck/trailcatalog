package org.trailcatalog.pbf

import crosby.binary.Osmformat.PrimitiveBlock
import crosby.binary.Osmformat.PrimitiveGroup
import java.io.InputStream
import java.nio.charset.StandardCharsets

abstract class PbfEntityInputStream(
  protected val block: PrimitiveBlock,
  private var current: ByteArray,
) : InputStream() {

  private var groupIndex = 0
  private var currentPos = 0

  override fun available(): Int {
    return current.size - currentPos
  }

  override fun read(): Int {
    throw NotImplementedError("read() is not implemented")
  }

  override fun read(b: ByteArray): Int {
    return read(b, 0, b.size)
  }

  override fun read(b: ByteArray, start: Int, len: Int): Int {
    var offset = start
    var remaining = len
    while (remaining > 0 && available() > 0) {
      val canGet = available()
      val got = canGet.coerceAtMost(remaining)
      System.arraycopy(current, currentPos, b, offset, got)
      currentPos += got
      offset += got
      remaining -= got
      if (got >= canGet) {
        moveNextCheckEnd()
      } else {
        break
      }
    }

    return if (remaining == len) {
      -1
    } else {
      offset - start
    }
  }

  private fun moveNextCheckEnd() {
    if (groupIndex >= block.primitivegroupCount) {
      current = byteArrayOf()
      currentPos = 1
    } else {
      val csv = StringBuilder()
      val group = block.getPrimitivegroup(groupIndex)
      convertToCsv(group, csv)
      current = csv.toString().toByteArray(StandardCharsets.UTF_8)
      currentPos = 0
      groupIndex += 1
    }
  }

  protected abstract fun convertToCsv(group: PrimitiveGroup, csv: StringBuilder)
}