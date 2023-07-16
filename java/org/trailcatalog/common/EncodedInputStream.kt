package org.trailcatalog.common

import java.io.InputStream
import kotlin.experimental.and
import kotlin.experimental.or

abstract class EncodedInputStream : InputStream() {

  abstract fun position(): Int
  abstract fun readUnsafe(): Byte
  abstract fun seek(position: UInt)
  abstract fun size(): Int

  override fun read(): Int {
    return if (position() < size()) {
      readUnsafe().toInt().and(0xFF)
    } else {
      -1
    }
  }

  fun readExactly(b: ByteArray, off: Int, len: Int): Int {
    var got = 0
    while (got < len) {
      val count = read(b, off + got, len - got)
      if (count == 0) {
        throw IllegalArgumentException("Unable to keep reading")
      }
      got += count
    }
    return got
  }

  fun readBoolean(): Boolean {
    return if (readUnsafe() == 1.toByte()) true else false
  }

  fun readDouble(): Double {
    return Double.fromBits(readLong())
  }

  fun readFloat(): Float {
    return Float.fromBits(readInt())
  }

  fun readInt(): Int {
    return (readUnsafe().toInt() and 0xFF) or
        ((readUnsafe().toInt() and 0xFF) shl 8) or
        ((readUnsafe().toInt() and 0xFF) shl 16) or
        ((readUnsafe().toInt() and 0xFF) shl 24)
  }

  fun readLong(): Long {
    return (readUnsafe().toLong() and 0xFF) or
        ((readUnsafe().toLong() and 0xFF) shl 8) or
        ((readUnsafe().toLong() and 0xFF) shl 16) or
        ((readUnsafe().toLong() and 0xFF) shl 24) or
        ((readUnsafe().toLong() and 0xFF) shl 32) or
        ((readUnsafe().toLong() and 0xFF) shl 40) or
        ((readUnsafe().toLong() and 0xFF) shl 48) or
        ((readUnsafe().toLong() and 0xFF) shl 56)
  }

  fun readShort(): Short {
    return (readUnsafe().toShort() and 0xFF) or
        ((readUnsafe().toShort() and 0xFF).toInt() shl 8).toShort()
  }

  fun readUInt(): UInt {
    return (readUnsafe().toUInt() and 0xFF.toUInt()) or
        ((readUnsafe().toUInt() and 0xFF.toUInt()) shl 8) or
        ((readUnsafe().toUInt() and 0xFF.toUInt()) shl 16) or
        ((readUnsafe().toUInt() and 0xFF.toUInt()) shl 24)
  }

  fun readUShort(): UShort {
    return (readUnsafe().toUShort() and 0xFF.toUShort()) or
        ((readUnsafe().toUShort() and 0xFF.toUShort()).toInt() shl 8).toUShort()
  }

  fun readVarInt(): Int {
    var i = 0
    var v = readUnsafe().toInt()
    var shift = 0
    while ((v and 0x80) != 0) {
      i = i or v.and(0x7F).shl(shift)
      shift += 7
      v = readUnsafe().toInt()
    }
    i = i or v.shl(shift)
    return i
  }

  fun readVarLong(): Long {
    var l = 0L
    var v = readUnsafe().toLong()
    var shift = 0
    while ((v and 0x80) != 0L) {
      l = l or v.and(0x7F).shl(shift)
      shift += 7
      v = readUnsafe().toLong()
    }
    l = l or v.shl(shift)
    return l
  }
}
