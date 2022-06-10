package org.trailcatalog.importers.pipeline.collections

import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pipeline.io.EncodedInputStream
import org.trailcatalog.importers.pipeline.io.EncodedOutputStream
import java.io.File
import java.io.RandomAccessFile
import java.nio.channels.FileChannel
import java.nio.channels.FileChannel.MapMode
import java.util.concurrent.atomic.AtomicInteger

open class MmapPList<T>(
    private val maps: List<EncodedInputStream>,
    private val serializer: Serializer<T>,
    private val size: Long,
    private val fileReference: FileReference,
) : PList<T> {

  private var shard = 0

  override fun close() {
    maps.forEach { it.close() }
    fileReference.close()
  }

  override fun estimatedByteSize(): Long {
    return size
  }

  override fun hasNext(): Boolean {
    return shard < maps.size
  }

  override fun next(): T {
    val value = serializer.read(maps[shard])
    while (shard < maps.size && !maps[shard].hasRemaining()) {
      shard += 1
    }
    return value
  }
}

open class MmapPSortedList<T>(private val list: MmapPList<T>) : PSortedList<T> {

  override fun close() {
    list.close()
  }

  override fun estimatedByteSize(): Long {
    return list.estimatedByteSize()
  }

  override fun find(needle: (v: T) -> Int): T? {
    TODO("Not yet implemented")
  }

  override fun hasNext(): Boolean {
    return list.hasNext()
  }

  override fun next(): T {
    return list.next()
  }
}

fun <T : Any> createMmapPList(
    type: TypeToken<out T>, handles: AtomicInteger, fn: (Emitter<T>) -> Unit): () -> MmapPList<T> {
  if (handles.get() == 0) throw RuntimeException("${type}")
  val serializer = getSerializer(type)
  val file = File.createTempFile(cleanFilename("mmap-list-${type}"), null)
  file.deleteOnExit()
  val shards = RandomAccessFile(file, "rw").use { raf ->
    val stream = EncodedOutputStream(raf.channel)
    stream.use { output ->
      val emitter = object : Emitter<T> {
        override fun emit(v: T) {
          serializer.write(v, output)
          output.checkBufferSpace()
        }
      }

      fn(emitter)
    }

    stream.shards()
  }

  val size = if (shards.isNotEmpty()) shards[shards.size - 1].let { it.start + it.length } else 0
  println("PList (mmap) ${type} size ${size}")

  val fileChannel = FileChannel.open(file.toPath())
  val fileReference = FileReference(file, handles)

  return {
    val maps = shards.map { s ->
      EncodedInputStream(fileChannel.map(MapMode.READ_ONLY, s.start, s.length))
    }
    MmapPList(maps, serializer, size, fileReference)
  }
}

fun <T : Comparable<T>> createMmapPSortedList(
    type: TypeToken<out T>,
    handles: AtomicInteger,
    fn: (Emitter<T>) -> Unit,
): () -> MmapPSortedList<T> {
  val interceptedFn = { emitter: Emitter<T> ->
    var last: T? = null
    val checkingEmitter = object : Emitter<T> {
      override fun emit(v: T) {
        val l = last
        if (l != null && l > v) {
          throw RuntimeException("Sort order was violated")
        }
        emitter.emit(v)
        last = v
      }
    }
    fn(checkingEmitter)
  }
  return {
    MmapPSortedList(createMmapPList(type, handles, interceptedFn).invoke())
  }
}

fun cleanFilename(raw: String): String {
  return raw
      .replace("? extends ", "")
      .replace("java.lang.", "")
      .replace("java.util.", "")
}