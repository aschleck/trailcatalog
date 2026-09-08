package org.trailcatalog.common

import java.nio.ByteBuffer

/**
 * Storage and wire format for a run of int64s
 *
 * Format:
 * * varint valueCount
 * * First value as little endian int64
 * * Then zigzag varints per value holding a delta
 */
object DeltaInt64 {

  /** Bytes [encode] can write for the given value count. */
  fun bytesFor(valueCount: Int): Int {
    if (valueCount <= 0) {
      return 1
    }
    return /* count= */ 5 + /* first value= */ 8 + (valueCount - 1) * /* a 10 byte varint= */ 10
  }

  /** Writes into the buffer at its position, leaving it after the last byte written. */
  fun encode(values: LongArray, valueCount: Int, buffer: ByteBuffer) {
    writeVarInt(valueCount, buffer)
    if (valueCount <= 0) {
      return
    }

    var last = values[0]
    writeLong(last, buffer)
    for (i in 1 until valueCount) {
      val next = values[i]
      writeVarLong(zigzag(next - last), buffer)
      last = next
    }
  }

  fun encode(values: LongArray): ByteArray {
    val buffer = ByteBuffer.allocate(bytesFor(values.size))
    encode(values, values.size, buffer)
    return buffer.array().copyOf(buffer.position())
  }

  /** Returns the values the encoding carries. */
  fun decode(encoded: ByteArray): LongArray {
    val cursor = intArrayOf(0)
    val valueCount = readVarInt(encoded, cursor)
    if (valueCount <= 0) {
      return LongArray(0)
    }

    val values = LongArray(valueCount)
    var last = readLong(encoded, cursor)
    values[0] = last
    for (i in 1 until valueCount) {
      last += unzigzag(readVarLong(encoded, cursor))
      values[i] = last
    }
    return values
  }

  fun valueCount(encoded: ByteArray): Int {
    return readVarInt(encoded, intArrayOf(0))
  }

  private fun zigzag(v: Long): Long {
    return (v shl 1) xor (v shr 63)
  }

  private fun unzigzag(v: Long): Long {
    return (v ushr 1) xor -(v and 1)
  }

  private fun writeVarInt(i: Int, buffer: ByteBuffer) {
    var v = i
    while (v and 0x7F.inv() != 0) {
      buffer.put(v.and(0x7F).or(0x80).toByte())
      v = v ushr 7
    }
    buffer.put(v.toByte())
  }

  private fun readVarInt(encoded: ByteArray, cursor: IntArray): Int {
    var i = 0
    var shift = 0
    while (true) {
      val v = encoded[cursor[0]++].toInt()
      i = i or (v and 0x7F shl shift)
      if (v and 0x80 == 0) {
        return i
      }
      shift += 7
    }
  }

  private fun writeVarLong(l: Long, buffer: ByteBuffer) {
    var v = l
    while (v and 0x7FL.inv() != 0L) {
      buffer.put(v.and(0x7FL).or(0x80L).toByte())
      v = v ushr 7
    }
    buffer.put(v.toByte())
  }

  private fun readVarLong(encoded: ByteArray, cursor: IntArray): Long {
    var l = 0L
    var shift = 0
    while (true) {
      val v = encoded[cursor[0]++].toLong()
      l = l or (v and 0x7FL shl shift)
      if (v and 0x80L == 0L) {
        return l
      }
      shift += 7
    }
  }

  private fun writeLong(l: Long, buffer: ByteBuffer) {
    for (i in 0 until 8) {
      buffer.put((l shr (8 * i)).toByte())
    }
  }

  private fun readLong(encoded: ByteArray, cursor: IntArray): Long {
    val at = cursor[0]
    cursor[0] = at + 8
    var l = 0L
    for (i in 0 until 8) {
      l = l or ((encoded[at + i].toLong() and 0xFF) shl (8 * i))
    }
    return l
  }
}
