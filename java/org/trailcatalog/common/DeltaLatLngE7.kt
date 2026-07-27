package org.trailcatalog.common

import java.nio.ByteBuffer

/**
 * Storage and wire format for a polyline of E7 lat/lng pairs.
 *
 * varint pointCount, then the first point as two little endian int32, then a zigzag varint per
 * coordinate holding its delta from the point before it.
 *
 * The first point stays fixed width because an absolute longitude reaches 1.8e9 and its zigzag is
 * 3.6e9, which overflows the 32 bit arithmetic that both this reader and the Javascript one use.
 * Eight bytes is also less than the ten that two five byte varints would cost.
 */
object DeltaLatLngE7 {

  // Measured over a 0.02% sample of the planet paths table: 82% of the points after the first fit
  // in four bytes, because a two byte zigzag varint reaches 8191 E7, which is 91 meters, and
  // consecutive OSM nodes are usually closer than that.
  // => 8 bytes for the first point, about 4.5 per point overall against 8 for fixed pairs

  /** Bytes [encode] can write for a polyline of the given point count. */
  fun bytesFor(pointCount: Int): Int {
    if (pointCount <= 0) {
      return 1
    }
    return /* count= */ 5 + /* first point= */ 8 + (pointCount - 1) * /* two 5 byte varints= */ 10
  }

  /** Writes into the buffer at its position, leaving it after the last byte written. */
  fun encode(latLngE7: IntArray, pointCount: Int, buffer: ByteBuffer) {
    writeVarInt(pointCount, buffer)
    if (pointCount <= 0) {
      return
    }

    var lat = latLngE7[0]
    var lng = latLngE7[1]
    writeInt(lat, buffer)
    writeInt(lng, buffer)
    for (i in 1 until pointCount) {
      val nextLat = latLngE7[2 * i]
      val nextLng = latLngE7[2 * i + 1]
      writeVarInt(zigzag(nextLat - lat), buffer)
      writeVarInt(zigzag(nextLng - lng), buffer)
      lat = nextLat
      lng = nextLng
    }
  }

  fun encode(latLngE7: IntArray): ByteArray {
    val pointCount = latLngE7.size / 2
    val buffer = ByteBuffer.allocate(bytesFor(pointCount))
    encode(latLngE7, pointCount, buffer)
    return buffer.array().copyOf(buffer.position())
  }

  /** Returns the interleaved lat/lng pairs the encoding carries. */
  fun decode(encoded: ByteArray): IntArray {
    val cursor = intArrayOf(0)
    val pointCount = readVarInt(encoded, cursor)
    if (pointCount <= 0) {
      return IntArray(0)
    }

    val latLngE7 = IntArray(2 * pointCount)
    var lat = readInt(encoded, cursor)
    var lng = readInt(encoded, cursor)
    latLngE7[0] = lat
    latLngE7[1] = lng
    for (i in 1 until pointCount) {
      lat += unzigzag(readVarInt(encoded, cursor))
      lng += unzigzag(readVarInt(encoded, cursor))
      latLngE7[2 * i] = lat
      latLngE7[2 * i + 1] = lng
    }
    return latLngE7
  }

  fun pointCount(encoded: ByteArray): Int {
    return readVarInt(encoded, intArrayOf(0))
  }

  private fun zigzag(v: Int): Int {
    return (v shl 1) xor (v shr 31)
  }

  private fun unzigzag(v: Int): Int {
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

  private fun writeInt(i: Int, buffer: ByteBuffer) {
    buffer.put(i.toByte())
    buffer.put((i shr 8).toByte())
    buffer.put((i shr 16).toByte())
    buffer.put((i shr 24).toByte())
  }

  private fun readInt(encoded: ByteArray, cursor: IntArray): Int {
    val at = cursor[0]
    cursor[0] = at + 4
    return (encoded[at].toInt() and 0xFF) or
        ((encoded[at + 1].toInt() and 0xFF) shl 8) or
        ((encoded[at + 2].toInt() and 0xFF) shl 16) or
        (encoded[at + 3].toInt() shl 24)
  }
}
