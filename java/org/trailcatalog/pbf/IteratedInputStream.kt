package org.trailcatalog.pbf

import java.io.InputStream
import java.nio.charset.StandardCharsets

abstract class IteratedInputStream<V>(
  iterable: Iterable<V>,
  private var current: ByteArray,
) : InputStream() {

  private val stringBuilder = StringBuilder()
  private val iterator: Iterator<V> = iterable.iterator()
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
    if (!iterator.hasNext()) {
      current = byteArrayOf()
      currentPos = 1
    } else {
      stringBuilder.clear()
      convertToCsv(iterator.next(), stringBuilder)
      current = stringBuilder.toString().toByteArray(StandardCharsets.UTF_8)
      currentPos = 0
    }
  }

  protected abstract fun convertToCsv(value: V, csv: StringBuilder)
}