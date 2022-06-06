package org.trailcatalog.importers.pipeline.collections

import com.google.common.collect.ImmutableList
import com.google.common.reflect.TypeToken
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.channels.FileChannel
import java.nio.channels.FileChannel.MapMode

open class MmapPList<T>(
    val maps: List<ByteBuffer>, val serializer: Serializer<T>, val size: Long) : PList<T> {

  var shard = 0

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

class MmapPSortedList<T>(
        maps: List<ByteBuffer>, serializer: Serializer<T>, size: Long)
    : MmapPList<T>(maps, serializer, size), PSortedList<T> {

  override fun find(needle: (v: T) -> Int): T? {
    TODO("Not yet implemented")
  }
}

fun <T : Any> createMmapPList(type: TypeToken<out T>, fn: (Emitter<T>) -> Unit): () -> MmapPList<T> {
  val serializer = getSerializer(type)
  val file = File.createTempFile(cleanFilename("mmap-list-${type}"), null)
  file.deleteOnExit()

  val shards = ImmutableList.builder<Pair<Long, Long>>()
  var start = 0L
  var length = 0L
  val buffer = ByteBuffer.allocate(8 * 1024 * 1024).order(ByteOrder.LITTLE_ENDIAN)
  FileOutputStream(file).use { output ->
    val emitter = object : Emitter<T> {
      override fun emit(v: T) {
        serializer.write(v, buffer)

        if (buffer.position() > 4 * 1024 * 1024) {
          output.write(buffer.array(), 0, buffer.position())
          length += buffer.position()
          buffer.rewind()
        }

        if (length > Integer.MAX_VALUE / 4) {
          shards.add(Pair(start, length))
          start += length
          length = 0
        }
      }
    }

    fn(emitter)

    output.write(buffer.array(), 0, buffer.position())
    length += buffer.position()
    if (length > 0) {
      shards.add(Pair(start, length))
      start += length
    }
  }

  println("PList (mmap) ${type} size ${start}")

  val fileChannel = FileChannel.open(file.toPath())
  val maps = shards.build().map { s ->
    fileChannel.map(MapMode.READ_ONLY, s.first, s.second).order(ByteOrder.LITTLE_ENDIAN)
  }

  return {
    MmapPList(maps, serializer, start)
  }
}

fun <T : Comparable<T>> createMmapPSortedList(type: TypeToken<T>, fn: (Emitter<T>) -> Unit):
    () -> MmapPSortedList<T> {
  val serializer = getSerializer(type)
  val file = File.createTempFile(cleanFilename("mmap-sorted-list-${type}-"), null)
  file.deleteOnExit()

  var last: T? = null
  val shards = ImmutableList.builder<Pair<Long, Long>>()
  var start = 0L
  var length = 0L
  val buffer = ByteBuffer.allocate(8 * 1024 * 1024).order(ByteOrder.LITTLE_ENDIAN)
  FileOutputStream(file).use { output ->
    val emitter = object : Emitter<T> {
      override fun emit(v: T) {
        val was = last
        if (was != null) {
          if (was.compareTo(v) != -1) {
            throw RuntimeException("Sorted order was violated")
          }
        }
        last = v

        serializer.write(v, buffer)

        if (buffer.position() > 4 * 1024 * 1024) {
          output.write(buffer.array(), 0, buffer.position())
          length += buffer.position()
          buffer.rewind()
        }

        if (length > Integer.MAX_VALUE / 4) {
          shards.add(Pair(start, length))
          start += length
          length = 0
        }
      }
    }

    fn(emitter)

    output.write(buffer.array(), 0, buffer.position())
    length += buffer.position()
    if (length > 0) {
      shards.add(Pair(start, length))
      start += length
    }
  }

  println("PSortedList (mmap) ${type} size ${start}")

  val fileChannel = FileChannel.open(file.toPath())
  val maps = shards.build().map { s ->
    fileChannel.map(MapMode.READ_ONLY, s.first, s.second).order(ByteOrder.LITTLE_ENDIAN)
  }

  return {
    MmapPSortedList(maps, serializer, start)
  }
}

fun cleanFilename(raw: String): String {
  return raw
      .replace("? extends ", "")
      .replace("java.lang.", "")
      .replace("java.util.", "")
}