package org.trailcatalog.importers.pipeline.collections

import com.google.common.reflect.TypeToken
import org.trailcatalog.common.ChannelEncodedOutputStream
import org.trailcatalog.common.EncodedByteBufferInputStream
import org.trailcatalog.importers.pipeline.progress.longProgress
import java.io.File
import java.io.RandomAccessFile
import java.nio.channels.FileChannel
import java.nio.channels.FileChannel.MapMode
import java.util.concurrent.ArrayBlockingQueue

open class MmapPList<T>(
    private val maps: List<EncodedByteBufferInputStream>,
    private val serializer: Serializer<T>,
    private val size: Long,
) : PList<T> {

  private var shard = 0

  override fun close() {
    maps.forEach { it.close() }
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
    type: TypeToken<out T>, fn: (Emitter<T>) -> Unit): DisposableSupplier<MmapPList<T>> {
  val serializer = getSerializer(type)
  val file = File.createTempFile(cleanFilename("mmap-list-${type}"), null)
  file.deleteOnExit()
  val startTime = System.currentTimeMillis()
  val shards = RandomAccessFile(file, "rw").use { raf ->
    val stream = ChannelEncodedOutputStream(raf.channel)
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
  val seconds = (System.currentTimeMillis() - startTime) / 1000
  println("PList (mmap) ${type} size ${size} (${seconds}s)")

  val fileReference = FileReference(file)

  return DisposableSupplier(fileReference) {
    val maps = FileChannel.open(file.toPath()).use { fileChannel ->
      shards.map { s ->
        EncodedByteBufferInputStream(fileChannel.map(MapMode.READ_ONLY, s.start, s.length))
      }
    }
    MmapPList(maps, serializer, size)
  }
}

private const val PARALLEL_PLIST_BATCH_SIZE = 1024
private val PLIST_SENTINEL_BATCH: List<Any?> = emptyList()

/**
 * Parallel variant of [createMmapPList]: drives [input] on the caller thread and dispatches
 * batches to [workers] worker threads, each writing into its own output file. With `workers <= 1`
 * this falls back to the single-threaded path so callers can pass the resolved parallelism
 * directly.
 */
fun <I, T : Any> createMmapPList(
    context: String,
    type: TypeToken<out T>,
    input: PCollection<I>,
    workers: Int,
    perItem: (I, Emitter<T>) -> Unit,
): DisposableSupplier<MmapPList<T>> {
  if (workers <= 1) {
    return createMmapPList(type) { emitter ->
      while (input.hasNext()) {
        perItem(input.next(), emitter)
      }
      input.close()
    }
  }

  val serializer = getSerializer(type)
  val startTime = System.currentTimeMillis()

  val workerFiles =
      (0 until workers).map { w ->
        File.createTempFile(cleanFilename("mmap-list-${type}-w${w}"), null).also {
          it.deleteOnExit()
        }
      }

  val queue =
      ArrayBlockingQueue<List<I>>((workers * 2).coerceAtLeast(2))
  val perWorkerShards = arrayOfNulls<List<org.trailcatalog.common.Extents>>(workers)

  longProgress("PList ${context} emitting (parallel x${workers})") { progress ->
    val workerThreads =
        (0 until workers).map { workerId ->
          Thread(
              {
                val raf = RandomAccessFile(workerFiles[workerId], "rw")
                try {
                  val stream = ChannelEncodedOutputStream(raf.channel)
                  stream.use { output ->
                    val emitter =
                        object : Emitter<T> {
                          override fun emit(v: T) {
                            serializer.write(v, output)
                            output.checkBufferSpace()
                            progress.increment()
                          }
                        }

                    while (true) {
                      val batch = queue.take()
                      if (batch === PLIST_SENTINEL_BATCH) break
                      for (item in batch) {
                        perItem(item, emitter)
                      }
                    }
                  }
                  perWorkerShards[workerId] = stream.shards()
                } finally {
                  raf.close()
                }
              },
              "mmap-plist-${context}-w${workerId}",
          )
        }

    workerThreads.forEach { it.start() }

    var batch = ArrayList<I>(PARALLEL_PLIST_BATCH_SIZE)
    while (input.hasNext()) {
      batch.add(input.next())
      if (batch.size >= PARALLEL_PLIST_BATCH_SIZE) {
        queue.put(batch)
        batch = ArrayList(PARALLEL_PLIST_BATCH_SIZE)
      }
    }
    if (batch.isNotEmpty()) {
      queue.put(batch)
    }
    @Suppress("UNCHECKED_CAST")
    repeat(workers) { queue.put(PLIST_SENTINEL_BATCH as List<I>) }

    workerThreads.forEach { it.join() }
  }

  input.close()

  val totalSize =
      workerFiles
          .zip(perWorkerShards.map { it!! })
          .sumOf { (_, shards) -> shards.sumOf { it.length } }
  val seconds = (System.currentTimeMillis() - startTime) / 1000
  println("PList (mmap parallel x${workers}) ${type} size ${totalSize} (${seconds}s)")

  val fileReferences = workerFiles.map { FileReference(it) }

  return DisposableSupplier(java.io.Closeable { fileReferences.forEach { it.close() } }) {
    val maps =
        workerFiles
            .zip(perWorkerShards.map { it!! })
            .flatMap { (file, shards) ->
              FileChannel.open(file.toPath()).use { fc ->
                shards.map { s ->
                  EncodedByteBufferInputStream(fc.map(MapMode.READ_ONLY, s.start, s.length))
                }
              }
            }
    MmapPList(maps, serializer, totalSize)
  }
}

fun <T : Comparable<T>> createMmapPSortedList(
    type: TypeToken<out T>,
    fn: (Emitter<T>) -> Unit,
): DisposableSupplier<MmapPSortedList<T>> {
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
  val list = createMmapPList(type, interceptedFn)
  return DisposableSupplier(list) {
    MmapPSortedList(list.invoke())
  }
}

fun cleanFilename(raw: String): String {
  return raw
      .replace("? extends ", "")
      .replace("java.lang.", "")
      .replace("java.util.", "")
}