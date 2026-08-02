package org.trailcatalog.common

import com.google.common.collect.ImmutableList
import org.trailcatalog.flags.FlagSpec
import org.trailcatalog.flags.createFlag
import java.nio.ByteBuffer
import java.nio.channels.WritableByteChannel

@FlagSpec(name = "block_size")
private val flushThreshold = createFlag(4 * 1024 * 1024)

@FlagSpec(name = "buffer_size")
private val bufferSize = createFlag(500 * 1024 * 1024)

class ChannelEncodedOutputStream(private val channel: WritableByteChannel) : EncodedOutputStream() {

  private val buffer = ByteBuffer.allocateDirect(bufferSize.value)
  private val shards = ImmutableList.builder<Extents>()
  private var start = 0L
  private var position = 0L

  fun position(): Long {
    return position
  }

  /**
   * Byte offset where the next call to write() will land in the underlying channel, accounting
   * for bytes still sitting in the internal buffer that haven't been flushed yet.
   */
  fun nextWriteOffset(): Long {
    return position + buffer.position()
  }

  fun shards(): List<Extents> {
    return shards.build()
  }

  /**
   * Immutable snapshot of the shards recorded so far. Subsequent writes / shard() calls will
   * not affect the returned list. Useful when you want to record the data extent before
   * appending a sidecar region (e.g. an index) into the same file.
   */
  fun shardsSnapshot(): List<Extents> {
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
    if (buffer.position() >= flushThreshold.value) {
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
