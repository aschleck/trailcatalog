package org.trailcatalog.common

import java.io.OutputStream

class DelegatingEncodedOutputStream(private val delegate: OutputStream) : EncodedOutputStream() {

  override fun close() {
    delegate.close()
  }

  override fun flush() {
    delegate.flush()
  }

  override fun write(b: Byte) {
    delegate.write(b.toInt())
  }

  override fun write(b: ByteArray, off: Int, len: Int) {
    delegate.write(b, off, len)
  }
}