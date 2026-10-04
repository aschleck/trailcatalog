package org.trailcatalog.importers.pipeline.collections

import com.google.common.reflect.TypeToken
import org.trailcatalog.common.ChannelEncodedOutputStream
import org.trailcatalog.common.EncodedByteBufferInputStream
import org.trailcatalog.common.EncodedInputStream
import org.trailcatalog.common.EncodedOutputStream
import org.trailcatalog.common.Extents
import org.trailcatalog.flags.FlagSpec
import org.trailcatalog.flags.createFlag
import org.trailcatalog.importers.pipeline.io.ByteBufferEncodedOutputStream
import org.trailcatalog.importers.pipeline.progress.longProgress
import java.io.Closeable
import java.io.File
import java.io.RandomAccessFile
import java.nio.BufferOverflowException
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.channels.FileChannel
import java.nio.channels.FileChannel.MapMode
import java.util.PriorityQueue
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

// A PMap is written as sorted runs. Each worker buffers what it's handed, sorts it once the buffer
// fills, and writes it out as a run. Readers then merge the runs, either on the fly for a single
// consumer or into a merged file for several.
//
// Run records:    key, value byte length, value
// Merged records: key, value count, total value byte length, values
//
// Both carry a byte length so that finding a key can skip over records without deserializing them.

// Heap reserved for everything that isn't a buffered record: the scratch buffers, the input
// pipeline, and the garbage G1 hasn't reclaimed yet. maxMemory minus this is split evenly across
// the workers.
@FlagSpec(name = "heap_dump_threshold")
private val heapDumpThreshold = createFlag(256 * 1024 * 1024L)

// ThreadLocal so workers don't race on the same scratch buffer. Each serializes one value at a time
// before copying the bytes into its run buffer. Values are almost always small, and a buffer of the
// largest one per worker per stage is what fragments the heap. See PIECE_BYTES.
private val SCRATCH: ThreadLocal<ByteBuffer> = ThreadLocal.withInitial {
  ByteBuffer.allocate(1024 * 1024).order(ByteOrder.LITTLE_ENDIAN)
}

/** Serializes [value] into this thread's scratch buffer, growing it to fit, and returns it. */
private fun <V> serialize(value: V, serializer: Serializer<V>): ByteBuffer {
  while (true) {
    val scratch = SCRATCH.get()
    scratch.clear()
    try {
      serializer.write(value, ByteBufferEncodedOutputStream(scratch))
      return scratch
    } catch (e: BufferOverflowException) {
      SCRATCH.set(ByteBuffer.allocate(2 * scratch.capacity()).order(ByteOrder.LITTLE_ENDIAN))
    }
  }
}

// Splitting a run into key ranges seeks to the index entry before each split key and scans
// forward, so this bounds that scan. 240 GB of planet node runs cost a million entries.
private const val INDEX_GRANULARITY_BYTES = 256L * 1024L

// Key ranges handed out per worker, so that a worker that drew a dense range doesn't hold up the
// rest.
private const val PARTS_PER_WORKER = 4

private const val PARALLEL_BATCH_SIZE = 1024

// Run buffers allocate in pieces of this many bytes. G1 treats an object of half a region or more
// as humongous, which it never moves, so a heap full of large buffers fragments until one more
// large allocation fails with plenty free. Regions are at least 4 MB on any heap of 8 GB or more,
// so this keeps every piece an ordinary object.
private const val PIECE_BYTES = 2 * 1024 * 1024

// What each slot of a primitive buffer's capacity costs, whether or not it holds a record:
//    8  the key
//    8  where the value sits
//    4  the value length
//   24  the radix sort's key and order arrays and their scratch copies
private const val PRIMITIVE_SLOT_BYTES = 44L

// What a buffered record costs besides its value bytes with other keys:
//   32  SortKey, a 16 byte header plus the key and value references
//   24  the boxed key
//   24  the ByteArray header
//    8  the ArrayList slot
private const val OBJECT_RECORD_OVERHEAD_BYTES = 88

// Sentinel passed through the work queue to signal a worker should drain and exit. Reference
// equality is what matters; the empty list contents are irrelevant.
private val SENTINEL_BATCH: List<Any?> = emptyList()

// Bytes of buffered records a single worker may hold.
private fun calculateMemoryBudgetPerShard(workers: Int): Long {
  return ((Runtime.getRuntime().maxMemory() - heapDumpThreshold.value) / workers)
      .coerceAtLeast(64 * 1024 * 1024)
}

fun <K : Comparable<K>, V : Any> createMmapPMap(
    context: String,
    keyType: TypeToken<K>,
    valueType: TypeToken<out V>,
    estimatedByteSize: Long,
    fn: (Emitter2<K, V>) -> Unit): DisposableSupplier<PMap<K, V>> {
  val codec = KeyCodec(keyType)
  val valueSerializer = getSerializer(valueType)

  val startTime = System.currentTimeMillis()
  val runs = emitRuns(context, keyType, valueType, codec, valueSerializer, fn)
  return materialize(context, keyType, valueType, codec, valueSerializer, runs, workers = 1).also {
    val seconds = (System.currentTimeMillis() - startTime) / 1000
    println("  PMap ${context} total ${seconds}s")
  }
}

/**
 * Parallel variant: [workers] threads each run [perItem] and write their own runs. Input that
 * can be partitioned is read by the workers directly, a key range at a time, and anything else is
 * driven on the caller thread and handed out in batches.
 *
 * With `workers <= 1` this delegates to the single-threaded path, so callers can pass the
 * resolved parallelism directly.
 *
 * With one dependant the merge runs inside the consumer's reads instead of writing a merged file.
 * See [StreamingMergePMap].
 */
fun <I, K : Comparable<K>, V : Any> createMmapPMap(
    context: String,
    keyType: TypeToken<K>,
    valueType: TypeToken<out V>,
    estimatedByteSize: Long,
    input: PCollection<I>,
    workers: Int,
    dependants: Int,
    perItem: (I, Emitter2<K, V>) -> Unit): DisposableSupplier<PMap<K, V>> {
  if (workers <= 1) {
    // The single-threaded path takes no dependant count, so it always materializes.
    return createMmapPMap(context, keyType, valueType, estimatedByteSize) { emitter ->
      while (input.hasNext()) {
        perItem(input.next(), emitter)
      }
      input.close()
    }
  }

  val codec = KeyCodec(keyType)
  val valueSerializer = getSerializer(valueType)

  val startTime = System.currentTimeMillis()
  val runs =
      emitRunsParallel(
          context, keyType, valueType, codec, valueSerializer, input, workers, perItem)

  if (dependants <= 1) {
    val seconds = (System.currentTimeMillis() - startTime) / 1000
    println(
        "  PMap ${context} emitted ${seconds}s (parallel x${workers}), merging on read" +
            " (${runs.chunks.size} shards, size ${runs.size})")
    val opened = AtomicInteger(0)
    // Unlinking a run leaves its mappings readable, which is what the merged path already relies
    // on when BoundStage closes the supplier before the consumer reads. Unmapping would crash the
    // reader, so that waits for the consumer to close the PMap.
    return DisposableSupplier({ runs.files.forEach { it.delete() } }) {
      if (opened.incrementAndGet() != 1) {
        throw RuntimeException("Streaming merge can only be used once")
      }
      StreamingMergePMap(runs.chunks, codec, valueSerializer, runs.size, runs::unmap)
    }
  }

  return materialize(context, keyType, valueType, codec, valueSerializer, runs, workers).also {
    val seconds = (System.currentTimeMillis() - startTime) / 1000
    println("  PMap ${context} total ${seconds}s (parallel x${workers})")
  }
}

/**
 * Reads and writes keys. Long and Int keys are fixed width, so they also travel as a primitive
 * long and sort without boxing.
 */
private class KeyCodec<K : Comparable<K>>(type: TypeToken<K>) {

  val serializer: Serializer<K> = getSerializer(type)
  private val width =
      when (type.rawType) {
        Long::class.javaPrimitiveType, Long::class.javaObjectType -> 8
        Int::class.javaPrimitiveType, Int::class.javaObjectType -> 4
        else -> 0
      }
  val primitive = width > 0

  fun toLong(key: K): Long {
    return (key as Number).toLong()
  }

  @Suppress("UNCHECKED_CAST")
  fun fromLong(key: Long): K {
    return (if (width == 8) key else key.toInt()) as K
  }

  // Matches the Long and Int serializers in Memory.kt
  fun readLong(from: EncodedInputStream): Long {
    return if (width == 8) from.readLong() else from.readInt().toLong()
  }

  fun writeLong(key: Long, to: EncodedOutputStream) {
    if (width == 8) to.writeLong(key) else to.writeInt(key.toInt())
  }
}

/** A sorted stretch of records within one mapping, with where some of its keys start. */
private class Chunk<K : Comparable<K>>(
    val buffer: ByteBuffer,
    val indexKeys: List<K>,
    val indexPositions: IntArray,
) {

  val start: Int
    get() = buffer.position()

  val end: Int
    get() = buffer.limit()

  fun slice(from: Int, to: Int): Chunk<K> {
    val view = buffer.duplicate()
    view.limit(to)
    view.position(from)
    var first = 0
    while (first < indexPositions.size && indexPositions[first] < from) {
      first += 1
    }
    var last = first
    while (last < indexPositions.size && indexPositions[last] < to) {
      last += 1
    }
    return Chunk(
        view,
        indexKeys.subList(first, last),
        indexPositions.copyOfRange(first, last))
  }

  /** Returns where the first record with a key at or past [key] starts, or [end] if none does. */
  fun positionOf(key: K, codec: KeyCodec<K>, grouped: Boolean): Int {
    var low = 0
    var high = indexKeys.size
    while (low < high) {
      val mid = (low + high) ushr 1
      if (indexKeys[mid] < key) {
        low = mid + 1
      } else {
        high = mid
      }
    }

    val view = buffer.duplicate()
    if (low > 0) {
      view.position(indexPositions[low - 1])
    }
    val stream = EncodedByteBufferInputStream(view, owned = false)
    while (view.hasRemaining()) {
      val position = view.position()
      if (codec.serializer.read(stream) >= key) {
        return position
      }
      if (grouped) {
        stream.readVarInt()
      }
      val length = stream.readVarInt()
      view.position(view.position() + length)
    }
    return end
  }
}

/** Cuts every chunk at [splits], returning the pieces of each key range in chunk order. */
private fun <K : Comparable<K>> splitChunks(
    chunks: List<Chunk<K>>,
    splits: List<K>,
    codec: KeyCodec<K>,
    grouped: Boolean): List<List<Chunk<K>>> {
  val parts = (0..splits.size).map { ArrayList<Chunk<K>>() }
  for (chunk in chunks) {
    var from = chunk.start
    for (i in 0..splits.size) {
      val to = if (i < splits.size) chunk.positionOf(splits[i], codec, grouped) else chunk.end
      if (to > from) {
        parts[i].add(chunk.slice(from, to))
        from = to
      }
    }
  }
  return parts
}

private fun bytesIn(chunks: List<Chunk<*>>): Long {
  return chunks.sumOf { (it.end - it.start).toLong() }
}

/** Reads one run a record at a time for a merge. */
private class RunCursor<K : Comparable<K>>(
    chunk: Chunk<K>,
    private val id: Int,
    private val codec: KeyCodec<K>,
) : Comparable<RunCursor<K>> {

  val buffer: ByteBuffer = chunk.buffer.duplicate()
  private val stream = EncodedByteBufferInputStream(buffer, owned = false)
  var longKey = 0L
    private set
  var objectKey: K? = null
    private set
  var valueStart = buffer.position()
    private set
  var valueLength = 0
    private set

  val key: K
    get() = if (codec.primitive) codec.fromLong(longKey) else objectKey!!

  /** Moves to the next record, returning false once the run is spent. */
  fun advance(): Boolean {
    buffer.position(valueStart + valueLength)
    if (!buffer.hasRemaining()) {
      return false
    }

    if (codec.primitive) {
      longKey = codec.readLong(stream)
    } else {
      objectKey = codec.serializer.read(stream)
    }
    valueLength = stream.readVarInt()
    valueStart = buffer.position()
    return true
  }

  fun <V> readValue(serializer: Serializer<V>): V {
    buffer.position(valueStart)
    return serializer.read(stream)
  }

  fun hasKey(long: Long, obj: K?): Boolean {
    return if (codec.primitive) longKey == long else objectKey!!.compareTo(obj!!) == 0
  }

  // Ties go to the earlier run, so values for one key come out in a stable order.
  override fun compareTo(other: RunCursor<K>): Int {
    val byKey =
        if (codec.primitive) longKey.compareTo(other.longKey)
        else objectKey!!.compareTo(other.objectKey!!)
    return if (byKey != 0) byKey else id.compareTo(other.id)
  }
}

/** Merges runs by key. */
private class RunMerger<K : Comparable<K>>(chunks: List<Chunk<K>>, codec: KeyCodec<K>) {

  private val heap = PriorityQueue<RunCursor<K>>(chunks.size.coerceAtLeast(1))

  init {
    chunks.forEachIndexed { i, chunk ->
      val cursor = RunCursor(chunk, i, codec)
      if (cursor.advance()) {
        heap.add(cursor)
      }
    }
  }

  fun hasNext(): Boolean {
    return heap.isNotEmpty()
  }

  /**
   * Hands every cursor holding the smallest key to [consume], which reads its value, and returns
   * that key.
   */
  fun nextGroup(consume: (RunCursor<K>) -> Unit): K {
    // A cursor's key is its heap position, so it comes out before advancing and goes back after.
    val first = heap.poll()
    val key = first.key
    val long = first.longKey
    val obj = first.objectKey
    consume(first)
    if (first.advance()) {
      heap.add(first)
    }

    // A run can hold the same key twice, so the re-added cursor gets rechecked here.
    while (heap.isNotEmpty() && heap.peek().hasKey(long, obj)) {
      val next = heap.poll()
      consume(next)
      if (next.advance()) {
        heap.add(next)
      }
    }
    return key
  }
}

/**
 * Lazy merge over the runs, standing in for a merged file.
 *
 * Materializing costs the stage's size twice over, once writing the merged file and once reading
 * it back. A single consumer only ever asks for one cursor, so the merge can happen in next() and
 * the pass disappears. Splitting it hands each part its own slice of every run, so that several
 * threads can merge at once.
 */
private class StreamingMergePMap<K : Comparable<K>, V : Any>(
    private val chunks: List<Chunk<K>>,
    private val codec: KeyCodec<K>,
    private val valueSerializer: Serializer<V>,
    private val size: Long,
    private val onClose: Closeable?,
) : SplittablePMap<K, V> {

  private val merger by lazy { RunMerger(chunks, codec) }

  override fun estimatedByteSize(): Long {
    return size
  }

  override fun close() {
    onClose?.close()
  }

  override fun hasNext(): Boolean {
    return merger.hasNext()
  }

  override fun next(): PEntry<K, V> {
    val values = ArrayList<V>()
    val key = merger.nextGroup { values.add(it.readValue(valueSerializer)) }
    return PEntry(key, values)
  }

  override fun sampleKeys(): List<K> {
    return chunks.flatMap { it.indexKeys }
  }

  override fun split(splits: List<K>): List<PMap<K, V>> {
    return splitChunks(chunks, splits, codec, grouped = false).map {
      StreamingMergePMap(it, codec, valueSerializer, bytesIn(it), null)
    }
  }
}

/** A merged map, read from its chunks in order. */
private class MmapPMap<K : Comparable<K>, V>(
    private val chunks: List<Chunk<K>>,
    private val codec: KeyCodec<K>,
    private val valueSerializer: Serializer<V>,
    private val size: Long,
    private val onClose: Closeable?,
) : SplittablePMap<K, V> {

  private var chunk = -1
  private var stream: EncodedByteBufferInputStream? = null

  override fun close() {
    onClose?.close()
  }

  override fun estimatedByteSize(): Long {
    return size
  }

  override fun hasNext(): Boolean {
    while (stream?.hasRemaining() != true) {
      chunk += 1
      if (chunk >= chunks.size) {
        return false
      }
      stream = EncodedByteBufferInputStream(chunks[chunk].buffer.duplicate(), owned = false)
    }
    return true
  }

  override fun next(): PEntry<K, V> {
    if (!hasNext()) {
      throw NoSuchElementException()
    }
    val stream = stream!!
    val key = codec.serializer.read(stream)
    val count = stream.readVarInt()
    stream.readVarInt()
    val values = ArrayList<V>(count)
    repeat(count) {
      values.add(valueSerializer.read(stream))
    }
    return PEntry(key, values)
  }

  override fun sampleKeys(): List<K> {
    return chunks.flatMap { it.indexKeys }
  }

  override fun split(splits: List<K>): List<PMap<K, V>> {
    return splitChunks(chunks, splits, codec, grouped = true).map {
      MmapPMap(it, codec, valueSerializer, bytesIn(it), null)
    }
  }
}

/** Records written so far, with an entry every [INDEX_GRANULARITY_BYTES] of output. */
private class IndexBuilder<K> {

  val keys = ArrayList<K>()
  var offsets = LongArray(1024)
    private set
  private var lastOffset = -INDEX_GRANULARITY_BYTES

  /** Starts a new run, whose first record always gets an entry. */
  fun startRun() {
    lastOffset = -INDEX_GRANULARITY_BYTES
  }

  fun wants(offset: Long): Boolean {
    return offset - lastOffset >= INDEX_GRANULARITY_BYTES
  }

  fun add(key: K, offset: Long) {
    if (keys.size == offsets.size) {
      offsets = offsets.copyOf(2 * offsets.size)
    }
    offsets[keys.size] = offset
    keys.add(key)
    lastOffset = offset
  }
}

/** Runs sitting in files, mapped. */
private class Runs<K : Comparable<K>>(
    val files: List<File>,
    val chunks: List<Chunk<K>>,
    private val mappings: List<ByteBuffer>,
) {

  val size = bytesIn(chunks)

  fun unmap() {
    mappings.forEach { EncodedByteBufferInputStream(it).close() }
  }
}

/** Maps each extent of [file] and hands it the index entries that fall inside it. */
private fun <K : Comparable<K>> mapExtents(
    file: File,
    extents: List<Extents>,
    index: IndexBuilder<K>,
): Pair<List<Chunk<K>>, List<ByteBuffer>> {
  val chunks = ArrayList<Chunk<K>>()
  val mappings = ArrayList<ByteBuffer>()
  var entry = 0
  FileChannel.open(file.toPath()).use { channel ->
    for (extent in extents) {
      val mapping = channel.map(MapMode.READ_ONLY, extent.start, extent.length)
      mappings.add(mapping)
      val from = entry
      while (entry < index.keys.size && index.offsets[entry] < extent.start + extent.length) {
        entry += 1
      }
      val positions = IntArray(entry - from) { (index.offsets[from + it] - extent.start).toInt() }
      chunks.add(Chunk(mapping, index.keys.subList(from, entry), positions))
    }
  }
  return Pair(chunks, mappings)
}

/** Records waiting to be sorted into a run. */
private interface RunBuffer<K, V> {

  /**
   * Takes the record, or returns false if holding it would go over budget and the buffer should
   * be written out first. An empty buffer always takes it.
   */
  fun add(key: K, value: V): Boolean

  /** Writes everything held in key order and empties the buffer. */
  fun writeSorted(output: ChannelEncodedOutputStream, index: IndexBuilder<K>)
}

// Longs per piece, so that a LongArray piece is PIECE_BYTES
private const val PIECE_SHIFT = 18
private const val PIECE_SLOTS = 1 shl PIECE_SHIFT
private const val PIECE_MASK = PIECE_SLOTS - 1

/** A growable long array kept in pieces, so growing never copies or allocates anything large. */
private class LongPieces {

  private val pieces = ArrayList<LongArray>()

  val capacity: Int
    get() = pieces.size * PIECE_SLOTS

  fun grow() {
    pieces.add(LongArray(PIECE_SLOTS))
  }

  operator fun get(i: Int): Long {
    return pieces[i ushr PIECE_SHIFT][i and PIECE_MASK]
  }

  operator fun set(i: Int, value: Long) {
    pieces[i ushr PIECE_SHIFT][i and PIECE_MASK] = value
  }
}

/** A growable int array kept in pieces, like [LongPieces]. */
private class IntPieces {

  private val pieces = ArrayList<IntArray>()

  val capacity: Int
    get() = pieces.size * PIECE_SLOTS

  fun grow() {
    pieces.add(IntArray(PIECE_SLOTS))
  }

  operator fun get(i: Int): Int {
    return pieces[i ushr PIECE_SHIFT][i and PIECE_MASK]
  }

  operator fun set(i: Int, value: Int) {
    pieces[i ushr PIECE_SHIFT][i and PIECE_MASK] = value
  }
}

/**
 * Holds keys as longs and values in shared arenas, so a full buffer is a few thousand modest
 * arrays rather than tens of millions of small objects. The budget covers everything allocated,
 * which runs ahead of what's held because slots and arenas come a piece at a time.
 */
private class PrimitiveRunBuffer<K : Comparable<K>, V>(
    private val codec: KeyCodec<K>,
    private val valueSerializer: Serializer<V>,
    private val budget: Long,
) : RunBuffer<K, V> {

  private val keys = LongPieces()
  // The arena in the high 32 bits and the offset within it in the low 32
  private val locations = LongPieces()
  private val lengths = IntPieces()
  private var count = 0
  private val arenas = ArrayList<ByteArray>()
  private var arena = -1
  private var arenaOffset = 0
  private var arenaBytes = 0L
  private val sorter = RadixSorter()

  override fun add(key: K, value: V): Boolean {
    val scratch = serialize(value, valueSerializer)
    val length = scratch.position()

    if (count == keys.capacity) {
      val slots = keys.capacity.toLong() + PIECE_SLOTS
      if (count > 0 && PRIMITIVE_SLOT_BYTES * slots + arenaBytes > budget) {
        return false
      }
      keys.grow()
      locations.grow()
      lengths.grow()
    }
    if (arena < 0 || arenas[arena].size - arenaOffset < length) {
      val next = arena + 1
      if (next == arenas.size || arenas[next].size < length) {
        // A value bigger than a piece gets an arena of its own.
        val size = maxOf(PIECE_BYTES, length).toLong()
        if (count > 0 && PRIMITIVE_SLOT_BYTES * keys.capacity + arenaBytes + size > budget) {
          return false
        }
        val fresh = ByteArray(size.toInt())
        if (next == arenas.size) {
          arenas.add(fresh)
        } else {
          arenaBytes -= arenas[next].size
          arenas[next] = fresh
        }
        arenaBytes += size
      }
      arena = next
      arenaOffset = 0
    }
    System.arraycopy(scratch.array(), 0, arenas[arena], arenaOffset, length)
    scratch.clear()

    keys[count] = codec.toLong(key)
    locations[count] = (arena.toLong() shl 32) or arenaOffset.toLong()
    lengths[count] = length
    count += 1
    arenaOffset += length
    return true
  }

  override fun writeSorted(output: ChannelEncodedOutputStream, index: IndexBuilder<K>) {
    val order = sorter.sort(keys, count)
    for (i in 0 until count) {
      val record = order[i]
      val offset = output.nextWriteOffset()
      if (index.wants(offset)) {
        index.add(codec.fromLong(keys[record]), offset)
      }
      codec.writeLong(keys[record], output)
      output.writeVarInt(lengths[record])
      val location = locations[record]
      output.write(
          arenas[(location ushr 32).toInt()], (location and 0xFFFFFFFFL).toInt(), lengths[record])
      output.checkBufferSpace()
    }

    // The arenas and pieces stay allocated for the next run.
    count = 0
    arena = -1
    arenaOffset = 0
  }
}

/** Sorts record indices by long key, stably, sixteen bits a pass. */
private class RadixSorter {

  private var keys = LongPieces()
  private var scratchKeys = LongPieces()
  private var order = IntPieces()
  private var scratchOrder = IntPieces()
  private val counts = IntArray(65536 + 1)

  /** Returns record indices in key order. The pieces are reused by the next call. */
  fun sort(input: LongPieces, n: Int): IntPieces {
    while (keys.capacity < n) {
      keys.grow()
      scratchKeys.grow()
      order.grow()
      scratchOrder.grow()
    }

    // Flipping the sign bit makes signed order and unsigned digit order agree.
    for (i in 0 until n) {
      keys[i] = input[i] xor Long.MIN_VALUE
      order[i] = i
    }

    var fromKeys = keys
    var fromOrder = order
    var toKeys = scratchKeys
    var toOrder = scratchOrder
    for (shift in 0 until 64 step 16) {
      counts.fill(0)
      for (i in 0 until n) {
        counts[((fromKeys[i] ushr shift) and 0xFFFF).toInt() + 1] += 1
      }
      // A pass where every key shares the digit would only copy, which is most high digits.
      if (counts.any { it == n }) {
        continue
      }
      for (d in 1 until counts.size) {
        counts[d] += counts[d - 1]
      }
      for (i in 0 until n) {
        val key = fromKeys[i]
        val digit = ((key ushr shift) and 0xFFFF).toInt()
        val to = counts[digit]
        counts[digit] = to + 1
        toKeys[to] = key
        toOrder[to] = fromOrder[i]
      }
      fromKeys = toKeys.also { toKeys = fromKeys }
      fromOrder = toOrder.also { toOrder = fromOrder }
    }
    return fromOrder
  }
}

/** Holds each record as an object, for keys that aren't a fixed width number. */
private class ObjectRunBuffer<K : Comparable<K>, V>(
    private val codec: KeyCodec<K>,
    private val valueSerializer: Serializer<V>,
    private val budget: Long,
) : RunBuffer<K, V> {

  private val items = ArrayList<SortKey<K>>()
  private var heldBytes = 0L

  override fun add(key: K, value: V): Boolean {
    val scratch = serialize(value, valueSerializer)
    val cost = OBJECT_RECORD_OVERHEAD_BYTES + scratch.position()
    if (items.isNotEmpty() && heldBytes + cost > budget) {
      return false
    }
    scratch.flip()
    val bytes = ByteArray(scratch.limit())
    scratch.get(bytes)
    scratch.clear()
    items.add(SortKey(key, bytes))
    heldBytes += cost
    return true
  }

  override fun writeSorted(output: ChannelEncodedOutputStream, index: IndexBuilder<K>) {
    // List.sort is stable, so equal keys keep the order they arrived in.
    items.sort()
    for (item in items) {
      val offset = output.nextWriteOffset()
      if (index.wants(offset)) {
        index.add(item.key, offset)
      }
      codec.serializer.write(item.key, output)
      output.writeVarInt(item.value.size)
      output.write(item.value)
      output.checkBufferSpace()
    }
    items.clear()
    heldBytes = 0
  }
}

private class SortKey<K : Comparable<K>>(val key: K, val value: ByteArray)
  : Comparable<SortKey<K>> {

  override fun compareTo(other: SortKey<K>): Int {
    return key.compareTo(other.key)
  }
}

/** Buffers records and writes them to [file] as sorted runs. */
private class RunWriter<K : Comparable<K>, V : Any>(
    val file: File,
    codec: KeyCodec<K>,
    valueSerializer: Serializer<V>,
    budget: Long,
) {

  private val raf = RandomAccessFile(file, "rw")
  private val output = ChannelEncodedOutputStream(raf.channel)
  private val buffer: RunBuffer<K, V> =
      if (codec.primitive) PrimitiveRunBuffer(codec, valueSerializer, budget)
      else ObjectRunBuffer(codec, valueSerializer, budget)
  val index = IndexBuilder<K>()

  fun emit(key: K, value: V) {
    if (!buffer.add(key, value)) {
      dump()
      check(buffer.add(key, value))
    }
  }

  private fun dump() {
    index.startRun()
    buffer.writeSorted(output, index)
    output.shard()
  }

  /** Writes what's left and returns the extents of every run. */
  fun finish(): List<Extents> {
    try {
      dump()
      output.close()
      return output.shards()
    } finally {
      raf.close()
    }
  }
}

private fun <K : Comparable<K>, V : Any> emitRuns(
    context: String,
    keyType: TypeToken<K>,
    valueType: TypeToken<out V>,
    codec: KeyCodec<K>,
    valueSerializer: Serializer<V>,
    fn: (Emitter2<K, V>) -> Unit): Runs<K> {
  val file = File.createTempFile(cleanFilename("mmap-map-sharded-${keyType}-${valueType}"), null)
  file.deleteOnExit()
  val writer = RunWriter(file, codec, valueSerializer, calculateMemoryBudgetPerShard(1))
  longProgress("${context} emitting to shard") { progress ->
    fn(object : Emitter2<K, V> {
      override fun emit(a: K, b: V) {
        progress.increment()
        writer.emit(a, b)
      }
    })
  }
  val extents = writer.finish()
  val (chunks, mappings) = mapExtents(file, extents, writer.index)
  val runs = Runs(listOf(file), chunks, mappings)
  println("  PMap (mmap) ${keyType} -> ${valueType} in ${chunks.size} shards (size ${runs.size})")
  return runs
}

private fun <I, K : Comparable<K>, V : Any> emitRunsParallel(
    context: String,
    keyType: TypeToken<K>,
    valueType: TypeToken<out V>,
    codec: KeyCodec<K>,
    valueSerializer: Serializer<V>,
    input: PCollection<I>,
    workers: Int,
    perItem: (I, Emitter2<K, V>) -> Unit,
): Runs<K> {
  val budget = calculateMemoryBudgetPerShard(workers)
  val writers =
      (0 until workers).map { w ->
        val file =
            File.createTempFile(
                cleanFilename("mmap-map-sharded-${keyType}-${valueType}-w${w}"), null)
        file.deleteOnExit()
        RunWriter(file, codec, valueSerializer, budget)
      }
  val extents = arrayOfNulls<List<Extents>>(workers)

  longProgress("${context} emitting to shards (parallel x${workers})") { progress ->
    runWorkers(context, input, workers, "mmap-pmap") { workerId, items ->
      val writer = writers[workerId]
      val emitter = object : Emitter2<K, V> {
        override fun emit(a: K, b: V) {
          writer.emit(a, b)
          progress.increment()
        }
      }
      items { perItem(it, emitter) }
      extents[workerId] = writer.finish()
    }
  }

  val chunks = ArrayList<Chunk<K>>()
  val mappings = ArrayList<ByteBuffer>()
  for ((i, writer) in writers.withIndex()) {
    val (c, m) = mapExtents(writer.file, extents[i]!!, writer.index)
    chunks.addAll(c)
    mappings.addAll(m)
  }
  val runs = Runs(writers.map { it.file }, chunks, mappings)
  println(
      "  PMap (mmap parallel x${workers}) ${keyType} -> ${valueType} in ${chunks.size} shards" +
          " (size ${runs.size})")
  return runs
}

/**
 * Runs [work] on [workers] threads, each given a way to pull its share of [input]. Partitionable
 * input is cut into key ranges that the workers take turns claiming. Anything else is read on the
 * caller thread and handed out in batches.
 */
internal fun <I> runWorkers(
    context: String,
    input: PCollection<I>,
    workers: Int,
    threadPrefix: String,
    work: (workerId: Int, items: ((I) -> Unit) -> Unit) -> Unit) {
  val failure = AtomicReference<Throwable>()
  val parts = (input as? Partitionable<I>)?.partition(workers * PARTS_PER_WORKER)
  val claimable = parts?.let { ConcurrentLinkedQueue(it) }
  // Cap at 2x workers so the producer can stay a step ahead without unbounded memory growth.
  val queue = ArrayBlockingQueue<List<I>>((workers * 2).coerceAtLeast(2))

  val threads =
      (0 until workers).map { workerId ->
        Thread(
            {
              try {
                work(workerId) { each ->
                  if (claimable != null) {
                    while (true) {
                      val part = claimable.poll() ?: break
                      while (part.hasNext()) {
                        each(part.next())
                      }
                    }
                  } else {
                    while (true) {
                      val batch = queue.take()
                      if (batch === SENTINEL_BATCH) break
                      for (item in batch) {
                        each(item)
                      }
                    }
                  }
                }
              } catch (e: Throwable) {
                failure.compareAndSet(null, e)
              }
            },
            "${threadPrefix}-${context}-w${workerId}",
        )
      }
  threads.forEach { it.start() }

  if (claimable == null) {
    var batch = ArrayList<I>(PARALLEL_BATCH_SIZE)
    while (input.hasNext()) {
      batch.add(input.next())
      if (batch.size >= PARALLEL_BATCH_SIZE) {
        if (!offerToWorkers(queue, batch, failure)) {
          break
        }
        batch = ArrayList(PARALLEL_BATCH_SIZE)
      }
    }
    if (batch.isNotEmpty()) {
      offerToWorkers(queue, batch, failure)
    }
    @Suppress("UNCHECKED_CAST")
    repeat(workers) { offerToWorkers(queue, SENTINEL_BATCH as List<I>, failure) }
  }

  // offerToWorkers drops the sentinels once a worker has failed, so the workers that are still
  // alive sit on take() and join never returns. The interrupt loses to the recorded failure at
  // compareAndSet, so we still report what the worker threw.
  if (failure.get() != null) {
    threads.forEach { it.interrupt() }
  }
  threads.forEach { it.join() }
  input.close()

  failure.get()?.let {
    throw RuntimeException("${context} worker failed", it)
  }
}

/**
 * Merges [runs] into files of grouped records, one key range per worker, and deletes the runs.
 * Each call of the returned supplier maps the files afresh, so every dependant reads on its own.
 */
private fun <K : Comparable<K>, V : Any> materialize(
    context: String,
    keyType: TypeToken<K>,
    valueType: TypeToken<out V>,
    codec: KeyCodec<K>,
    valueSerializer: Serializer<V>,
    runs: Runs<K>,
    workers: Int,
): DisposableSupplier<PMap<K, V>> {
  val splits = chooseSplits(runs.chunks.flatMap { it.indexKeys }, workers)
  val parts = splitChunks(runs.chunks, splits, codec, grouped = false)
  val files =
      parts.indices.map {
        File.createTempFile(cleanFilename("mmap-map-merged-${keyType}-${valueType}-p${it}"), null)
            .also { file -> file.deleteOnExit() }
      }
  val extents = arrayOfNulls<List<Extents>>(parts.size)
  val indexes = arrayOfNulls<IndexBuilder<K>>(parts.size)
  val failure = AtomicReference<Throwable>()

  longProgress("${context} merging shards") { progress ->
    val threads =
        parts.indices.map { p ->
          Thread(
              {
                try {
                  val index = IndexBuilder<K>()
                  extents[p] = mergeInto(files[p], parts[p], codec, index) {
                    progress.incrementBy(it)
                  }
                  indexes[p] = index
                } catch (e: Throwable) {
                  failure.compareAndSet(null, e)
                }
              },
              "mmap-merge-${context}-p${p}")
        }
    threads.forEach { it.start() }
    threads.forEach { it.join() }
  }

  runs.unmap()
  runs.files.forEach { it.delete() }
  failure.get()?.let {
    throw RuntimeException("PMap ${context} merge failed", it)
  }

  val size = extents.sumOf { e -> e!!.sumOf { it.length } }
  val entries = indexes.sumOf { it!!.keys.size }
  println("  PMap (mmap) ${keyType} -> ${valueType} size ${size} (index ${entries})")

  return DisposableSupplier({ files.forEach { it.delete() } }) {
    val chunks = ArrayList<Chunk<K>>()
    val mappings = ArrayList<ByteBuffer>()
    for (p in files.indices) {
      val (c, m) = mapExtents(files[p], extents[p]!!, indexes[p]!!)
      chunks.addAll(c)
      mappings.addAll(m)
    }
    MmapPMap(chunks, codec, valueSerializer, size) {
      mappings.forEach { EncodedByteBufferInputStream(it).close() }
    }
  }
}

/** Merges [chunks] into [file] as grouped records, copying value bytes without decoding them. */
private fun <K : Comparable<K>> mergeInto(
    file: File,
    chunks: List<Chunk<K>>,
    codec: KeyCodec<K>,
    index: IndexBuilder<K>,
    progress: (Int) -> Unit): List<Extents> {
  RandomAccessFile(file, "rw").use { raf ->
    val output = ChannelEncodedOutputStream(raf.channel)
    output.use {
      val merger = RunMerger(chunks, codec)
      var buffers = arrayOfNulls<ByteBuffer>(16)
      var starts = IntArray(16)
      var lengths = IntArray(16)
      var count = 0
      while (merger.hasNext()) {
        val offset = output.nextWriteOffset()
        count = 0
        var total = 0
        val key = merger.nextGroup {
          if (count == buffers.size) {
            buffers = buffers.copyOf(2 * count)
            starts = starts.copyOf(2 * count)
            lengths = lengths.copyOf(2 * count)
          }
          buffers[count] = it.buffer
          starts[count] = it.valueStart
          lengths[count] = it.valueLength
          total += it.valueLength
          count += 1
        }

        if (index.wants(offset)) {
          index.add(key, offset)
        }
        codec.serializer.write(key, output)
        output.writeVarInt(count)
        output.writeVarInt(total)
        for (i in 0 until count) {
          output.write(buffers[i]!!, starts[i], lengths[i])
        }
        output.checkBufferSpace()
        progress(count)
      }
    }
    return output.shards()
  }
}
