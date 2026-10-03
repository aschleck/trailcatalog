package org.trailcatalog.common

import java.lang.reflect.Method
import java.nio.ByteBuffer
import java.nio.MappedByteBuffer
import kotlin.math.min

/**
 * Reads [buffer] from its current position. Closing unmaps a mapped buffer unless [owned] is
 * false, which views over a mapping someone else closes have to pass.
 */
class EncodedByteBufferInputStream(
    private val buffer: ByteBuffer,
    private val owned: Boolean = true,
) : EncodedInputStream() {

  override fun available(): Int {
    return buffer.limit() - buffer.position()
  }

  fun hasRemaining(): Boolean {
    return buffer.hasRemaining()
  }

  override fun position(): Int {
    return buffer.position()
  }

  override fun seek(position: UInt) {
    if (position > Int.MAX_VALUE.toUInt()) {
      throw IllegalArgumentException("Unable to seek past Int.MAX_VALUE")
    }
    buffer.position(position.toInt())
  }

  override fun size(): Int {
    return buffer.limit()
  }

  override fun readUnsafe(): Byte {
    return buffer.get()
  }

  override fun read(b: ByteArray, off: Int, len: Int): Int {
    val count = min(len, buffer.limit() - buffer.position())
    buffer.get(b, off, count)
    return count
  }

  override fun close() {
    if (owned && buffer is MappedByteBuffer) {
      close(buffer)
    }
  }

  companion object {

    private val unsafe: Any
    private val invokeCleaner: Method

    init {
      val unsafeClazz = Class.forName("sun.misc.Unsafe")
      unsafe = unsafeClazz.getDeclaredField("theUnsafe").apply {
        isAccessible = true
      }.get(null)
      invokeCleaner = unsafeClazz.getMethod("invokeCleaner", ByteBuffer::class.java).apply {
        isAccessible = true
      }
    }

    private fun close(buffer: MappedByteBuffer) {
      invokeCleaner.invoke(unsafe, buffer)
    }
  }
}
