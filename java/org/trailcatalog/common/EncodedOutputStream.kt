package org.trailcatalog.common

import java.io.OutputStream
import java.nio.ByteBuffer

data class Extents(val start: Long, val length: Long)

abstract class EncodedOutputStream : OutputStream() {

  abstract fun write(b: Byte)

  override fun write(b: Int) {
    write(b.toByte())
  }

  abstract override fun write(b: ByteArray, off: Int, len: Int)

  fun write(buffer: ByteBuffer) {
    write(buffer.array(), buffer.arrayOffset() + buffer.position(), buffer.limit())
  }

  fun writeBoolean(b: Boolean) {
    write(if (b) 1 else 0)
  }

  fun writeDouble(d: Double) {
    writeLong(d.toRawBits())
  }

  fun writeInt(i: Int) {
    write(i.toByte())
    write((i ushr 8).toByte())
    write((i ushr 16).toByte())
    write((i ushr 24).toByte())
  }

  fun writeUInt(i: UInt) {
    write(i.toByte())
    write((i shr 8).toByte())
    write((i shr 16).toByte())
    write((i shr 24).toByte())
  }

  fun writeVarInt(i: Int) {
    var v = i
    while (v and 0x7F.inv() != 0) {
      write(v.and(0x7F).or(0x80).toByte())
      v = v ushr 7
    }
    write(v.toByte())
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

  fun writeVarLong(l: Long) {
    var v = l
    while (v and 0x7F.inv() != 0L) {
      write(v.and(0x7F).or(0x80).toByte())
      v = v ushr 7
    }
    write(v.toByte())
  }

  fun writeShort(s: Short) {
    write(s.toByte())
    write((s.toInt() ushr 8).toByte())
  }

  fun writeUShort(s: UShort) {
    write(s.toByte())
    write((s.toInt() ushr 8).toByte())
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

    fun varLongSize(l: Long): Int {
      var v = l
      var bytes = 1
      while (v and 0x7F.inv() != 0L) {
        v = v ushr 7
        bytes += 1
      }
      return bytes
    }
  }
}

