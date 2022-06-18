package org.trailcatalog.importers.pipeline.io

import java.io.OutputStream

var BUFFER_SIZE = 8 * 1024 * 1024
var FLUSH_THRESHOLD = 64 * 1024

data class Extents(val start: Long, val length: Long)

abstract class EncodedOutputStream : OutputStream() {

  abstract fun write(b: Byte)

  override fun write(b: Int) {
    write(b.toByte())
  }

  abstract override fun write(b: ByteArray, off: Int, len: Int)

  fun writeDouble(d: Double) {
    writeLong(d.toRawBits())
  }

  fun writeInt(i: Int) {
    write(i.toByte())
    write((i ushr 8).toByte())
    write((i ushr 16).toByte())
    write((i ushr 24).toByte())
  }

  fun writeVarInt(i: Int): Long {
    var v = i
    var bytes = 1L
    while (v and 0x7F.inv() != 0) {
      write(v.and(0x7F).or(0x80).toByte())
      v = v ushr 7
      bytes += 1
    }
    write(v.toByte())
    return bytes
  }

  fun writeFloat(f: Float) {
    writeInt(f.toRawBits())
  }

  fun writeLong(l: Long) {
    write(l.toByte())
    write((l ushr 8).toByte())
    write((l ushr 16).toByte())
    write((l ushr 24).toByte())
    write((l ushr 32).toByte())
    write((l ushr 40).toByte())
    write((l ushr 48).toByte())
    write((l ushr 56).toByte())
  }

  companion object {
    fun varIntSize(i: Int): Int {
      var v = i
      var bytes = 1
      while (v and 0x7F.inv() != 0) {
        v = v ushr 7
        bytes += 1
      }
      return bytes
    }
  }
}

