package org.trailcatalog.importers.pipeline

import com.google.common.collect.ImmutableList
import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pipeline.collections.Serializer
import org.trailcatalog.importers.pipeline.collections.getSerializer
import org.trailcatalog.common.EncodedByteBufferInputStream
import org.trailcatalog.common.EncodedInputStream
import org.trailcatalog.common.Extents
import java.io.File
import java.io.RandomAccessFile
import java.nio.channels.FileChannel.MapMode

inline fun <reified T : Any> binaryStructListReader(file: File): PSource<T> {
  val serializer = getSerializer(TypeToken.of(T::class.java))
  return BinaryStructListReader<T>(file, serializer)
}

class BinaryStructListReader<T : Any>(
    private val file: File,
    private val serializer: Serializer<T>) : PSource<T>() {

  override fun read() = sequence {
    val shardsPath = File(file.path + ".shards")
    val shards = RandomAccessFile(shardsPath, "r").use {
      val map = it.channel.map(MapMode.READ_ONLY, 0, shardsPath.length())
      val shards = ImmutableList.builder<Extents>()
      EncodedByteBufferInputStream(map).use { input ->
        while (input.hasRemaining()) {
          shards.add(Extents(input.readLong(), input.readLong()))
        }
      }
      shards.build()
    }

    for (shard in shards) {
      RandomAccessFile(file, "r").use {
        val map = it.channel.map(MapMode.READ_ONLY, shard.start, shard.length)
        EncodedByteBufferInputStream(map).use { input ->
          while (input.hasRemaining()) {
            yield(serializer.read(input))
          }
        }
      }
    }
  }
}
