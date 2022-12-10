package org.trailcatalog.importers.pipeline.io

import java.nio.ByteBuffer
import org.trailcatalog.common.EncodedOutputStream

class ByteBufferEncodedOutputStream(private val buffer: ByteBuffer) : EncodedOutputStream() {

  override fun write(b: Byte) {
    buffer.put(b)
  }

  override fun write(b: ByteArray, off: Int, len: Int) {
    buffer.put(b, off, len)
  }
}