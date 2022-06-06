package org.trailcatalog.importers.pipeline.collections

import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pipeline.progress.longProgress
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.channels.FileChannel
import java.nio.channels.FileChannel.MapMode
import java.util.PriorityQueue

class MmapPMap<K : Comparable<K>, V>(
    val maps: List<ByteBuffer>,
    val keySerializer: Serializer<K>,
    val valueSerializer: Serializer<V>,
    val size: Long) : PMap<K, V> {

  var shard = 0

  override fun estimatedByteSize(): Long {
    return size
  }

  override fun hasNext(): Boolean {
    return shard < maps.size
  }

  override fun next(): PEntry<K, V> {
    val buffer = maps[shard]
    val key = keySerializer.read(buffer)
    val count = buffer.asIntBuffer().get()
    buffer.position(buffer.position() + 4)
    val list = ArrayList<V>()
    repeat(count) {
      list.add(valueSerializer.read(buffer))
    }

    while (shard < maps.size && !maps[shard].hasRemaining()) {
      shard += 1
    }

    return PEntry(key, list)
  }
}

fun <K : Comparable<K>, V : Any> createMmapPMap(
    context: String,
    keyType: TypeToken<K>,
    valueType: TypeToken<out V>,
    fn: (Emitter2<K, V>) -> Unit): () -> MmapPMap<K, V> {
  val keySerializer = getSerializer(keyType)
  val valueSerializer = getSerializer(valueType)

  val shards = emitToSortedShards(context, keyType, valueType, keySerializer, valueSerializer, fn)
  val merged = mergeSortedShards(context, keyType, valueType, shards, keySerializer)

  return {
    MmapPMap(merged, keySerializer, valueSerializer, merged.sumOf { it.limit().toLong() })
  }
}

private fun <K : Comparable<K>, V : Any> emitToSortedShards(
    context: String,
    keyType: TypeToken<K>,
    valueType: TypeToken<out V>,
    keySerializer: Serializer<K>,
    valueSerializer: Serializer<V>,
    fn: (Emitter2<K, V>) -> Unit): List<ByteBuffer> {
  val sharded =
      File.createTempFile(cleanFilename("mmap-map-sharded-${keyType}-${valueType}"), null)
  sharded.deleteOnExit()

  val shards = ArrayList<Pair<Long, Long>>()
  val buffer = ByteBuffer.allocate(1024 * 1024).order(ByteOrder.LITTLE_ENDIAN)
  val itemsInShard = ArrayList<SortKey<K>>()
  var shardStart = 0L
  var shardValuesSize = 0L
  FileOutputStream(sharded).use { output ->
    val emitter = object : Emitter2<K, V> {
      override fun emit(a: K, b: V) {
        valueSerializer.write(b, buffer)
        val bytes = ByteArray(buffer.position())
        buffer.get(0, bytes)
        itemsInShard.add(SortKey(a, bytes))
        shardValuesSize += bytes.size
        buffer.rewind()

        if (shardValuesSize > Integer.MAX_VALUE / 4) {
          itemsInShard.sortBy { it.key }
          var shardSize: Long = 0
          for (item in itemsInShard) {
            keySerializer.write(item.key, buffer)
            buffer.asIntBuffer().put(item.value.size)
            buffer.position(buffer.position() + 4)
            buffer.put(item.value)
            output.write(buffer.array(), 0, buffer.position())
            shardSize += buffer.position()
            buffer.rewind()
          }

          itemsInShard.clear()
          shards.add(Pair(shardStart, shardSize))
          shardStart += shardSize
          shardValuesSize = 0
        }
      }
    }

    longProgress("${context} emitting to shard") { progress ->
      val logged = object : Emitter2<K, V> {
        override fun emit(a: K, b: V) {
          progress.increment()
          emitter.emit(a, b)
        }
      }
      fn(logged)

      itemsInShard.sortBy { it.key }
      var shardSize: Long = 0
      for (item in itemsInShard) {
        keySerializer.write(item.key, buffer)
        buffer.asIntBuffer().put(item.value.size)
        buffer.position(buffer.position() + 4)
        buffer.put(item.value)
        output.write(buffer.array(), 0, buffer.position())
        shardSize += buffer.position()
        buffer.rewind()
      }

      itemsInShard.clear()
      shards.add(Pair(shardStart, shardSize))
      shardStart += shardSize
      shardValuesSize = 0
    }
  }

  println("  PMap (mmap) ${keyType} -> ${valueType} in ${shards.size} shards (size ${shardStart})")

  val fileChannel = FileChannel.open(sharded.toPath())
  return shards.map { s ->
    fileChannel.map(MapMode.READ_ONLY, s.first, s.second).order(ByteOrder.LITTLE_ENDIAN)
  }
}

private fun <K : Comparable<K>, V : Any> mergeSortedShards(
    context: String,
    keyType: TypeToken<K>,
    valueType: TypeToken<out V>,
    shards: List<ByteBuffer>,
    keySerializer: Serializer<K>): List<ByteBuffer> {
  val merged =
      File.createTempFile(cleanFilename("mmap-map-merged-${keyType}-${valueType}"), null)
  val maps = ArrayList<Pair<Long, Long>>()
  merged.deleteOnExit()

  var start = 0L
  var length = 0L
  val buffer = ByteBuffer.allocate(8 * 1024 * 1024).order(ByteOrder.LITTLE_ENDIAN)
  FileOutputStream(merged).use { output ->
    val heap = PriorityQueue<MergeKey<K>>()
    for (shard in shards) {
      if (shard.hasRemaining()) {
        val key = keySerializer.read(shard)
        val size = shard.asIntBuffer().get()
        shard.position(shard.position() + 4)
        val value = ByteArray(size)
        shard.get(value)
        heap.add(MergeKey(key, value, shard))
      }
    }

    longProgress("${context} merging shards") { progress ->
      var last: K? = null
      val values = ArrayList<ByteArray>()
      while (heap.isNotEmpty()) {
        val min = heap.poll()
        if (last == null) {
          last = min.key
        } else if (last.compareTo(min.key) != 0) {
          keySerializer.write(last, buffer)
          buffer.asIntBuffer().put(values.size)
          buffer.position(buffer.position() + 4)
          for (value in values) {
            buffer.put(value)
          }
          progress.incrementBy(values.size)
          values.clear()
          output.write(buffer.array(), 0, buffer.position())
          length += buffer.position()
          buffer.rewind()
          last = min.key

          if (length > Integer.MAX_VALUE / 4) {
            maps.add(Pair(start, length))
            start += length
            length = 0
          }
        }

        values.add(min.value)

        val source = min.source
        if (source.hasRemaining()) {
          val key = keySerializer.read(source)
          val size = source.asIntBuffer().get()
          source.position(source.position() + 4)
          val value = ByteArray(size)
          min.source.get(value)
          heap.add(MergeKey(key, value, min.source))
        }
      }

      if (last != null) {
        keySerializer.write(last, buffer)
        buffer.asIntBuffer().put(values.size)
        buffer.position(buffer.position() + 4)
        for (value in values) {
          buffer.put(value)
        }
        progress.incrementBy(values.size)
        values.clear()
        output.write(buffer.array(), 0, buffer.position())
        length += buffer.position()
      }
    }

    if (length > 0) {
      maps.add(Pair(start, length))
      start += length
    }
  }

  println("  PMap (mmap) ${keyType} -> ${valueType} size ${start}")

  val postsortChannel = FileChannel.open(merged.toPath())
  return maps.map { s ->
    postsortChannel.map(MapMode.READ_ONLY, s.first, s.second).order(ByteOrder.LITTLE_ENDIAN)
  }
}

private data class MergeKey<K : Comparable<K>>(
    val key: K, val value: ByteArray, val source: ByteBuffer)
  : Comparable<MergeKey<K>> {

  override fun compareTo(other: MergeKey<K>): Int {
    return key.compareTo(other.key)
  }
}

private data class SortKey<K : Comparable<K>>(val key: K, val value: ByteArray)
