package org.trailcatalog.importers.pipeline

import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pipeline.PSource
import org.trailcatalog.importers.pipeline.collections.Serializer
import org.trailcatalog.importers.pipeline.collections.getSerializer
import org.trailcatalog.importers.pipeline.io.EncodedInputStream
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
    RandomAccessFile(file, "r").use {
      val map = it.channel.map(MapMode.READ_ONLY, 0, file.length())
      EncodedInputStream(map).use { input ->
        while (input.hasRemaining()) {
          yield(serializer.read(input))
        }
      }
    }
  }
}
