package org.trailcatalog.importers.pipeline

import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pipeline.PSink
import org.trailcatalog.importers.pipeline.collections.PCollection
import org.trailcatalog.importers.pipeline.collections.Serializer
import org.trailcatalog.importers.pipeline.collections.getSerializer
import org.trailcatalog.importers.pipeline.io.ChannelEncodedOutputStream
import java.io.File
import java.io.RandomAccessFile

inline fun <reified T : Any> binaryStructListWriter(file: File): PSink<PCollection<T>> {
  val serializer = getSerializer(TypeToken.of(T::class.java))
  return BinaryStructListWriter<T>(file, serializer)
}

class BinaryStructListWriter<T : Any>(
    private val file: File,
    private val serializer: Serializer<T>) : PSink<PCollection<T>>() {

  override fun write(input: PCollection<T>) {
    RandomAccessFile(file, "rw").use {
      ChannelEncodedOutputStream(it.channel).use { output ->
        while (input.hasNext()) {
          serializer.write(input.next(), output)
        }
        input.close()
      }
    }
  }
}
