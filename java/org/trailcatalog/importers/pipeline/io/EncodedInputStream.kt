package org.trailcatalog.importers.pipeline.io

import java.io.InputStream
import java.nio.MappedByteBuffer
import kotlin.math.min

class EncodedInputStream(private val buffer: MappedByteBuffer) : InputStream() {

  override fun available(): Int {
    return buffer.limit() - buffer.position()
  }

  fun hasRemaining(): Boolean {
    return buffer.hasRemaining()
  }

  fun position(): Int {
    return buffer.position()
  }

  fun size(): Int {
    return buffer.limit()
  }

  override fun read(): Int {
    return if (buffer.position() < buffer.limit()) {
      buffer.get().toInt().and(0xFF)
    } else {
      -1
    }
  }

  override fun read(b: ByteArray, off: Int, len: Int): Int {
    val count = min(len, buffer.limit() - buffer.position())
    buffer.get(b, off, count)
    return count
  }

  fun readInt(): Int {
    return (buffer.get().toInt() and 0xFF) or
        ((buffer.get().toInt() and 0xFF) shl 8) or
        ((buffer.get().toInt() and 0xFF) shl 16) or
        ((buffer.get().toInt() and 0xFF) shl 24)
  }

  fun readLong(): Long {
    return (buffer.get().toLong() and 0xFF) or
        ((buffer.get().toLong() and 0xFF) shl 8) or
        ((buffer.get().toLong() and 0xFF) shl 16) or
        ((buffer.get().toLong() and 0xFF) shl 24) or
        ((buffer.get().toLong() and 0xFF) shl 32) or
        ((buffer.get().toLong() and 0xFF) shl 40) or
        ((buffer.get().toLong() and 0xFF) shl 48) or
        ((buffer.get().toLong() and 0xFF) shl 56)
  }

  fun readVarInt(): Int {
    var i = 0
    var v = buffer.get().toInt()
    var shift = 0
    while ((v and 0x80) != 0) {
      i = i or v.and(0x7F).shl(shift)
      shift += 7
      v = buffer.get().toInt()
    }
    i = i or v.shl(shift)
    return i
  }
}