package org.trailcatalog.importers.pipeline.io

import com.google.common.collect.ImmutableList
import java.io.OutputStream
import java.nio.ByteBuffer
import java.nio.channels.FileChannel

var BUFFER_SIZE = 8 * 1024 * 1024
var FLUSH_THRESHOLD = 64 * 1024

data class Extents(val start: Long, val length: Long)

class EncodedOutputStream(private val channel: FileChannel) : OutputStream() {

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

  private val buffer = ByteBuffer.allocateDirect(BUFFER_SIZE)
  private val shards = ImmutableList.builder<Extents>()
  private var start = 0L
  private var position = 0L

  fun position(): Long {
    return position
  }

  fun shards(): List<Extents> {
    return shards.build()
  }

  override fun write(b: Int) {
    buffer.put(b.toByte())
  }

  override fun write(b: ByteArray, off: Int, len: Int) {
    buffer.put(b, off, len)
  }

  fun writeDouble(d: Double) {
    writeLong(d.toRawBits())
  }

  fun writeInt(i: Int) {
    buffer.put(i.toByte())
    buffer.put((i ushr 8).toByte())
    buffer.put((i ushr 16).toByte())
    buffer.put((i ushr 24).toByte())
  }

  fun writeVarInt(i: Int): Long {
    var v = i
    var bytes = 1L
    while (v and 0x7F.inv() != 0) {
      buffer.put(v.and(0x7F).or(0x80).toByte())
      v = v ushr 7
      bytes += 1
    }
    buffer.put(v.toByte())
    return bytes
  }

  fun writeFloat(f: Float) {
    writeInt(f.toRawBits())
  }

  fun writeLong(l: Long) {
    buffer.put(l.toByte())
    buffer.put((l ushr 8).toByte())
    buffer.put((l ushr 16).toByte())
    buffer.put((l ushr 24).toByte())
    buffer.put((l ushr 32).toByte())
    buffer.put((l ushr 40).toByte())
    buffer.put((l ushr 48).toByte())
    buffer.put((l ushr 56).toByte())
  }

  override fun close() {
    shard()
    super.close()
  }

  override fun flush() {
    buffer.flip()
    val wrote = channel.write(buffer)
    if (wrote != buffer.limit()) {
      throw RuntimeException("Didn't write all bytes")
    }
    position += buffer.limit()
    buffer.clear()
  }

  fun checkBufferSpace() {
    if (buffer.position() >= FLUSH_THRESHOLD) {
      flush()

      if (position - start > 2_000_000_000) {
        shard()
      }
    }
  }

  fun shard() {
    flush()
    if (position > start) {
      shards.add(Extents(start, position - start))
      start = position
    }
  }
}