package org.trailcatalog.importers.pipeline.io

import com.google.common.collect.ImmutableList
import java.nio.ByteBuffer
import java.nio.channels.WritableByteChannel
import org.trailcatalog.common.EncodedOutputStream
import org.trailcatalog.common.Extents

var BUFFER_SIZE = 500 * 1024 * 1024
var FLUSH_THRESHOLD = 4 * 1024 * 1024

class ChannelEncodedOutputStream(private val channel: WritableByteChannel)
  : EncodedOutputStream() {

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

  override fun write(b: Byte) {
    buffer.put(b)
  }

  override fun write(b: ByteArray, off: Int, len: Int) {
    if (len <= buffer.limit() - buffer.position()) {
      buffer.put(b, off, len)
    } else {
      if (buffer.position() > 0) {
        flush()
      }
      val wrote = channel.write(ByteBuffer.wrap(b, off, len))
      if (wrote != len) {
        throw RuntimeException("Didn't write all bytes")
      }
      position += wrote
    }
  }

  override fun close() {
    shard()
    super.close()
    channel.close()
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

  // TODO(april): since I broke down and added buffer checking to write, does this do much?
  // Thought: yes. Because we can't flush after write(Byte) in case it's part of a larger
  // serialization. So we need to checkBufferSpace after all of that.
  fun checkBufferSpace() {
    if (buffer.position() >= FLUSH_THRESHOLD) {
      flush()
    }

    if (position - start > 2_000_000_000) {
      shard()
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
