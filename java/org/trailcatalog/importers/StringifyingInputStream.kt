package org.trailcatalog.importers

import java.io.InputStream
import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets

class StringifyingInputStream<V>(
    private val iterator: Iterator<V>,
    private val convert: (value: V, builder: StringBuilder) -> Unit,
) : InputStream() {

  private val stringBuilder = StringBuilder()
  private var current = "\n".encodeToByteArray()
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
    currentPos = 0
    stringBuilder.clear()
    while (iterator.hasNext() && stringBuilder.isEmpty()) {
      convert(iterator.next(), stringBuilder)
      current = stringBuilder.toString().toByteArray(StandardCharsets.UTF_8)
    }

    if (stringBuilder.isEmpty()) {
      current = byteArrayOf()
      currentPos = 1
    }
  }
}

val HEX_CHARACTERS = "0123456789abcdef".toCharArray()

fun appendByteBuffer(bytes: ByteBuffer, output: StringBuilder) {
  output.append("\\x")
  while (bytes.hasRemaining()) {
    val b = bytes.get()
    val i = b.toInt() and 0xff
    output.append(HEX_CHARACTERS[i / 16])
    output.append(HEX_CHARACTERS[i % 16])
  }
}

fun appendByteArray(bytes: ByteArray, output: StringBuilder) {
  output.append("\\x")
  for (b in bytes) {
    val i = b.toInt() and 0xff
    output.append(HEX_CHARACTERS[i / 16])
    output.append(HEX_CHARACTERS[i % 16])
  }
}
