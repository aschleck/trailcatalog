package org.trailcatalog.importers.pipeline.io

import com.google.common.collect.ImmutableList
import java.nio.ByteBuffer
import java.nio.channels.WritableByteChannel

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
    buffer.put(b, off, len)
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
    }

    if (position - start > 2_000_000_000) {
      shard()
    }
  }

  fun checkBufferSpaceNoShard() {
    if (buffer.position() >= FLUSH_THRESHOLD) {
      flush()
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