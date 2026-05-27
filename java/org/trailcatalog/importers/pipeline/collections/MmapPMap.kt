package org.trailcatalog.importers.pipeline.collections

import com.google.common.reflect.TypeToken
import org.trailcatalog.common.ChannelEncodedOutputStream
import org.trailcatalog.common.EncodedByteBufferInputStream
import org.trailcatalog.common.Extents
import org.trailcatalog.importers.pipeline.io.ByteBufferEncodedOutputStream
import org.trailcatalog.importers.pipeline.progress.longProgress
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.channels.FileChannel
import java.nio.channels.FileChannel.MapMode
import java.util.PriorityQueue
import java.util.concurrent.ArrayBlockingQueue

var HEAP_DUMP_THRESHOLD = 256 * 1024 * 1024L
// ThreadLocal so worker threads in parallel-extract mode don't race on the same scratch buffer.
// Each thread serializes one record at a time before copying the bytes out into the shard list.
private val BYTE_BUFFER: ThreadLocal<ByteBuffer> = ThreadLocal.withInitial {
  ByteBuffer.allocate(256 * 1024 * 1024).order(ByteOrder.LITTLE_ENDIAN)
}

/**
 * One entry every ~1 MB of merged output, paired with a fixed-size footer at the end of the
 * file. Lets Phase 2's parallel zip pick split keys without scanning gigabytes of data.
 */
private const val INDEX_GRANULARITY_BYTES = 1024L * 1024L

// Footer (24 bytes, little-endian) sits at the very end of every merged PMap file:
//   8 bytes  magic
//   8 bytes  file offset where the index begins
//   8 bytes  number of index entries
private const val INDEX_FOOTER_MAGIC: Long = 0x504D6170496E6478L  // "PMapIndx"
private const val INDEX_FOOTER_SIZE: Long = 24L

/** An index entry: a key from the merged data and the file offset where its record starts. */
data class PMapIndexEntry<K>(val key: K, val offset: Long)

class MmapPMap<K : Comparable<K>, V>(
    private val maps: List<EncodedByteBufferInputStream>,
    private val keySerializer: Serializer<K>,
    private val valueSerializer: Serializer<V>,
    private val size: Long,
    /**
     * Sparse (key, file-offset) entries — one every ~1 MB of merged output. Populated for PMaps
     * produced by [mergeSortedShards]; may be empty for PMaps with no producer-side index
     * (parallel emit fallback paths, tests). Phase 2's parallel zip uses this to pick split
     * keys without scanning the data.
     */
    val index: List<PMapIndexEntry<K>> = emptyList(),
) : PMap<K, V> {

  var shard = 0

  override fun close() {
    maps.forEach { it.close() }
  }

  override fun estimatedByteSize(): Long {
    return size
  }

  override fun hasNext(): Boolean {
    return shard < maps.size
  }

  override fun next(): PEntry<K, V> {
    val buffer = maps[shard]
    val key = keySerializer.read(buffer)
    val count = buffer.readVarInt()
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
    estimatedByteSize: Long,
    fn: (Emitter2<K, V>) -> Unit): DisposableSupplier<MmapPMap<K, V>> {
  val keySerializer = getSerializer(keyType)
  val valueSerializer = getSerializer(valueType)

  val startTime = System.currentTimeMillis()
  val (shardedFiles, shards) =
      emitToSortedShards(context, keyType, valueType, keySerializer, valueSerializer, fn)
  return mergeSortedShards(
      context,
      keyType,
      valueType,
      shards,
      keySerializer,
      valueSerializer,
      estimatedByteSize,
  ).also {
    shards.forEach { it.close() }
    shardedFiles.forEach { it.delete() }
    val seconds = (System.currentTimeMillis() - startTime) / 1000
    println("  PMap ${context} total ${seconds}s")
  }
}

/**
 * Parallel variant: drives [input] iteration on the caller thread and dispatches batches to
 * [workers] worker threads, each running [perItem] and writing into its own pre-sort shard file.
 * The K-way merge picks up shards from all worker files transparently.
 *
 * With `workers <= 1` this delegates to the single-threaded path, so callers can pass the
 * resolved parallelism directly.
 */
fun <I, K : Comparable<K>, V : Any> createMmapPMap(
    context: String,
    keyType: TypeToken<K>,
    valueType: TypeToken<out V>,
    estimatedByteSize: Long,
    input: PCollection<I>,
    workers: Int,
    perItem: (I, Emitter2<K, V>) -> Unit): DisposableSupplier<MmapPMap<K, V>> {
  if (workers <= 1) {
    return createMmapPMap(context, keyType, valueType, estimatedByteSize) { emitter ->
      while (input.hasNext()) {
        perItem(input.next(), emitter)
      }
      input.close()
    }
  }

  val keySerializer = getSerializer(keyType)
  val valueSerializer = getSerializer(valueType)

  val startTime = System.currentTimeMillis()
  val (shardedFiles, shards) =
      emitToSortedShardsParallel(
          context, keyType, valueType, keySerializer, valueSerializer, input, workers, perItem)
  return mergeSortedShards(
      context,
      keyType,
      valueType,
      shards,
      keySerializer,
      valueSerializer,
      estimatedByteSize,
  ).also {
    shards.forEach { it.close() }
    shardedFiles.forEach { it.delete() }
    val seconds = (System.currentTimeMillis() - startTime) / 1000
    println("  PMap ${context} total ${seconds}s (parallel x${workers})")
  }
}

private fun <K : Comparable<K>, V : Any> emitToSortedShards(
    context: String,
    keyType: TypeToken<K>,
    valueType: TypeToken<out V>,
    keySerializer: Serializer<K>,
    valueSerializer: Serializer<V>,
    fn: (Emitter2<K, V>) -> Unit): Pair<List<File>, List<EncodedByteBufferInputStream>> {
  val sharded =
      File.createTempFile(cleanFilename("mmap-map-sharded-${keyType}-${valueType}"), null)
  sharded.deleteOnExit()
  val shards = RandomAccessFile(sharded, "rw").use {
    val stream = ChannelEncodedOutputStream(it.channel)
    val runtime = Runtime.getRuntime()
    val maxMemory = runtime.maxMemory()
    stream.use { output ->
      val itemsInShard = ArrayList<SortKey<K>>()
      var shardValuesSize = 0L

      val dumpShard = {
        itemsInShard.sort()
        for (item in itemsInShard) {
          keySerializer.write(item.key, output)
          output.writeVarInt(item.value.size)
          output.write(item.value)
          output.checkBufferSpace()
        }

        output.shard()
        itemsInShard.clear()
        shardValuesSize = 0
      }

      var lastHeapCheck = 0L

      val emitter = object : Emitter2<K, V> {
        override fun emit(a: K, b: V) {
          val buffer = BYTE_BUFFER.get()
          valueSerializer.write(b, ByteBufferEncodedOutputStream(buffer))
          buffer.flip()
          val bytes = ByteArray(buffer.limit())
          buffer.get(bytes)
          buffer.clear()
          itemsInShard.add(SortKey(a, bytes))
          shardValuesSize += bytes.size

          // Check the heap every 50mb.
          if (shardValuesSize - lastHeapCheck > 50 * 1024 * 1024) {
            val remains = maxMemory - (runtime.totalMemory() - runtime.freeMemory())
            // If we have less than 256mb of memory, dump
            if (remains < HEAP_DUMP_THRESHOLD) {
              dumpShard()
            }
            lastHeapCheck = shardValuesSize
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

        dumpShard()
      }
    }

    stream.shards()
  }

  val size = if (shards.isNotEmpty()) shards[shards.size - 1].let { it.start + it.length } else 0
  println("  PMap (mmap) ${keyType} -> ${valueType} in ${shards.size} shards (size ${size})")

  val fileChannel = FileChannel.open(sharded.toPath())
  return Pair(listOf(sharded), shards.map { s ->
    EncodedByteBufferInputStream(fileChannel.map(MapMode.READ_ONLY, s.start, s.length))
  })
}

private const val PARALLEL_BATCH_SIZE = 1024

// Sentinel passed through the work queue to signal a worker should drain and exit. Reference
// equality is what matters; the empty list contents are irrelevant.
private val SENTINEL_BATCH: List<Any?> = emptyList()

private fun <I, K : Comparable<K>, V : Any> emitToSortedShardsParallel(
    context: String,
    keyType: TypeToken<K>,
    valueType: TypeToken<out V>,
    keySerializer: Serializer<K>,
    valueSerializer: Serializer<V>,
    input: PCollection<I>,
    workers: Int,
    perItem: (I, Emitter2<K, V>) -> Unit,
): Pair<List<File>, List<EncodedByteBufferInputStream>> {
  val workerFiles =
      (0 until workers).map { w ->
        File.createTempFile(
            cleanFilename("mmap-map-sharded-${keyType}-${valueType}-w${w}"),
            null,
        ).also { it.deleteOnExit() }
      }

  // Queue of input batches to dispatch to workers. Cap at 2x workers so the producer can stay
  // a step ahead without unbounded memory growth.
  val queueCapacity = (workers * 2).coerceAtLeast(2)
  val queue = ArrayBlockingQueue<List<I>>(queueCapacity)

  val perWorkerShards = arrayOfNulls<List<Extents>>(workers)
  val runtime = Runtime.getRuntime()
  val maxMemory = runtime.maxMemory()

  longProgress("${context} emitting to shards (parallel x${workers})") { progress ->
    val workerThreads =
        (0 until workers).map { workerId ->
          Thread(
              {
                val raf = RandomAccessFile(workerFiles[workerId], "rw")
                try {
                  val stream = ChannelEncodedOutputStream(raf.channel)
                  stream.use { output ->
                    val itemsInShard = ArrayList<SortKey<K>>()
                    var shardValuesSize = 0L

                    val dumpShard = {
                      itemsInShard.sort()
                      for (item in itemsInShard) {
                        keySerializer.write(item.key, output)
                        output.writeVarInt(item.value.size)
                        output.write(item.value)
                        output.checkBufferSpace()
                      }
                      output.shard()
                      itemsInShard.clear()
                      shardValuesSize = 0
                    }

                    var lastHeapCheck = 0L
                    val emitter =
                        object : Emitter2<K, V> {
                          override fun emit(a: K, b: V) {
                            val buffer = BYTE_BUFFER.get()
                            valueSerializer.write(b, ByteBufferEncodedOutputStream(buffer))
                            buffer.flip()
                            val bytes = ByteArray(buffer.limit())
                            buffer.get(bytes)
                            buffer.clear()
                            itemsInShard.add(SortKey(a, bytes))
                            shardValuesSize += bytes.size
                            progress.increment()

                            // Heap check is racy across workers but the worst outcome is an
                            // unnecessary or skipped dump; safe.
                            if (shardValuesSize - lastHeapCheck > 50 * 1024 * 1024) {
                              val remains =
                                  maxMemory - (runtime.totalMemory() - runtime.freeMemory())
                              if (remains < HEAP_DUMP_THRESHOLD) {
                                dumpShard()
                              }
                              lastHeapCheck = shardValuesSize
                            }
                          }
                        }

                    while (true) {
                      val batch = queue.take()
                      if (batch === SENTINEL_BATCH) break
                      for (item in batch) {
                        perItem(item, emitter)
                      }
                    }

                    dumpShard()
                  }
                  perWorkerShards[workerId] = stream.shards()
                } finally {
                  raf.close()
                }
              },
              "mmap-pmap-${context}-w${workerId}",
          )
        }

    workerThreads.forEach { it.start() }

    // Producer (this thread): batch input items and push to queue.
    var batch = ArrayList<I>(PARALLEL_BATCH_SIZE)
    while (input.hasNext()) {
      batch.add(input.next())
      if (batch.size >= PARALLEL_BATCH_SIZE) {
        queue.put(batch)
        batch = ArrayList(PARALLEL_BATCH_SIZE)
      }
    }
    if (batch.isNotEmpty()) {
      queue.put(batch)
    }
    @Suppress("UNCHECKED_CAST")
    repeat(workers) { queue.put(SENTINEL_BATCH as List<I>) }

    workerThreads.forEach { it.join() }
  }

  input.close()

  val combinedFileShards =
      workerFiles.mapIndexed { i, file -> file to perWorkerShards[i]!! }
  val totalShards = combinedFileShards.sumOf { it.second.size }
  val totalSize = combinedFileShards.sumOf { (_, shards) -> shards.sumOf { it.length } }
  println(
      "  PMap (mmap parallel x${workers}) ${keyType} -> ${valueType} in ${totalShards} shards" +
          " (size ${totalSize})")

  // Open every worker file's shards as mmap'd input streams. Each worker file gets one
  // FileChannel; we map each shard's extent into its own buffer.
  val streams =
      combinedFileShards.flatMap { (file, shards) ->
        val channel = FileChannel.open(file.toPath())
        channel.use { fc ->
          shards.map { s ->
            EncodedByteBufferInputStream(fc.map(MapMode.READ_ONLY, s.start, s.length))
          }
        }
      }

  return Pair(workerFiles, streams)
}

private fun <K : Comparable<K>, V : Any> mergeSortedShards(
    context: String,
    keyType: TypeToken<K>,
    valueType: TypeToken<out V>,
    unmergedShards: List<EncodedByteBufferInputStream>,
    keySerializer: Serializer<K>,
    valueSerializer: Serializer<V>,
    estimatedByteSize: Long,
): DisposableSupplier<MmapPMap<K, V>> {
  val merged =
      File.createTempFile(cleanFilename("mmap-map-merged-${keyType}-${valueType}"), null)
  merged.deleteOnExit()

  // Index entries accumulated while the data is being written. One entry per ~1 MB.
  val indexKeys = ArrayList<K>()
  val indexOffsets = ArrayList<Long>()

  // After the data is fully written, snapshot the data shards (so MmapPMap only mmaps the
  // data extents, not the trailing index/footer region).
  var dataShards: List<org.trailcatalog.common.Extents> = emptyList()
  var indexStart: Long = 0L

  RandomAccessFile(merged, "rw").use {
    val stream = ChannelEncodedOutputStream(it.channel)
    stream.use { output ->
      val heap = PriorityQueue<MergeKey<K>>()
      for (shard in unmergedShards) {
        if (shard.hasRemaining()) {
          val key = keySerializer.read(shard)
          val size = shard.readVarInt()
          val value = ByteArray(size)
          shard.read(value)
          heap.add(MergeKey(key, value, shard))
        }
      }

      var lastIndexedOffset = -INDEX_GRANULARITY_BYTES

      fun maybeIndex(key: K, recordOffset: Long) {
        if (recordOffset - lastIndexedOffset >= INDEX_GRANULARITY_BYTES) {
          indexKeys.add(key)
          indexOffsets.add(recordOffset)
          lastIndexedOffset = recordOffset
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
            val recordOffset = output.nextWriteOffset()
            maybeIndex(last, recordOffset)
            keySerializer.write(last, output)
            output.writeVarInt(values.size)
            for (value in values) {
              output.write(value)
            }
            output.checkBufferSpace()
            progress.incrementBy(values.size)
            values.clear()
            last = min.key
          }

          values.add(min.value)

          val source = min.source
          if (source.hasRemaining()) {
            val key = keySerializer.read(source)
            val size = source.readVarInt()
            val value = ByteArray(size)
            source.read(value)
            heap.add(MergeKey(key, value, min.source))
          }
        }

        if (last != null) {
          val recordOffset = output.nextWriteOffset()
          maybeIndex(last, recordOffset)
          keySerializer.write(last, output)
          output.writeVarInt(values.size)
          for (value in values) {
            output.write(value)
          }
          progress.incrementBy(values.size)
          values.clear()
        }
      }

      // Close the data region as a shard so MmapPMap doesn't mmap the index/footer as data.
      output.shard()
      dataShards = output.shardsSnapshot()

      // Write the sparse index, then a fixed-size footer pointing at it.
      indexStart = output.nextWriteOffset()
      for (i in indexKeys.indices) {
        keySerializer.write(indexKeys[i], output)
        output.writeLong(indexOffsets[i])
      }

      output.writeLong(INDEX_FOOTER_MAGIC)
      output.writeLong(indexStart)
      output.writeLong(indexKeys.size.toLong())
    }
  }

  val size =
      if (dataShards.isNotEmpty()) dataShards[dataShards.size - 1].let { it.start + it.length }
      else 0
  println("  PMap (mmap) ${keyType} -> ${valueType} size ${size} (index ${indexKeys.size})")
  println("  -> estimated ${estimatedByteSize} bytes (${estimatedByteSize * 100.0 / size}%)")

  val fileReference = FileReference(merged)
  val indexEntries = indexKeys.indices.map { PMapIndexEntry(indexKeys[it], indexOffsets[it]) }

  return DisposableSupplier(fileReference) {
    val opened = FileChannel.open(merged.toPath()).use { postsortChannel ->
      dataShards.map { s ->
        EncodedByteBufferInputStream(postsortChannel.map(MapMode.READ_ONLY, s.start, s.length))
      }
    }
    MmapPMap(
        opened,
        keySerializer,
        valueSerializer,
        opened.sumOf { it.size().toLong() },
        index = indexEntries,
    )
  }
}

private data class MergeKey<K : Comparable<K>>(
    val key: K, val value: ByteArray, val source: EncodedByteBufferInputStream)
  : Comparable<MergeKey<K>> {

  override fun compareTo(other: MergeKey<K>): Int {
    return key.compareTo(other.key)
  }
}

private data class SortKey<K : Comparable<K>>(val key: K, val value: ByteArray)
  : Comparable<SortKey<K>> {

  override fun compareTo(other: SortKey<K>): Int {
    return key.compareTo(other.key)
  }
}
