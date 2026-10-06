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
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import java.util.zip.Deflater
import java.util.zip.Inflater

// A PMap is written as sorted runs. Each worker buffers what it's handed, sorts it once the buffer
// fills, and writes it out as a run. Readers then merge the runs, either on the fly for a single
// consumer or into a merged file for several.
//
// Runs and merged files are a series of compressed blocks, each holding whole records:
//   block:          compressed length, raw length, the records Deflated
//   run record:     key, value byte length, value
//   merged record:  key, value count, total value byte length, values
//
// The stages that write and merge these are bound by the scratch disk while the CPU idles, so
// trading CPU for bytes pays. Long and Int keys are stored as the difference from the previous key
// in the block, which the sort makes small. Records carry a byte length so that finding a key can
// skip over them without deserializing values.

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

// Records go into blocks of about this many bytes before compression. Every block gets an index
// entry, and splitting a run decompresses and scans the block before each split key, so this
// bounds that scan. 240 GB of planet node runs cost a million entries.
private const val BLOCK_BYTES = 256 * 1024

// Reused per thread, because each holds a native zlib stream.
private val DEFLATER: ThreadLocal<Deflater> =
    ThreadLocal.withInitial { Deflater(Deflater.BEST_SPEED) }
private val INFLATER: ThreadLocal<Inflater> = ThreadLocal.withInitial { Inflater() }

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

}

// A position within a chunk: the block's offset in the mapping in the high 32 bits and the offset
// of a record within the block's decompressed bytes in the low 32.
private fun position(block: Int, offset: Int): Long {
  return (block.toLong() shl 32) or offset.toLong()
}

private fun blockOf(position: Long): Int {
  return (position ushr 32).toInt()
}

private fun offsetOf(position: Long): Int {
  return (position and 0xFFFFFFFFL).toInt()
}

/** A decompressed block, and where the block after it starts in the mapping. */
private class Block(val raw: ByteArray, val next: Int)

// A fresh array per block, because a merge holds onto value bytes from a block it has moved past.
private fun readBlock(mapping: ByteBuffer, offset: Int): Block {
  val view = mapping.duplicate()
  view.position(offset)
  val header = EncodedByteBufferInputStream(view, owned = false)
  val compressed = header.readVarInt()
  val raw = ByteArray(header.readVarInt())
  val data = view.position()
  view.limit(data + compressed)

  val inflater = INFLATER.get()
  inflater.reset()
  inflater.setInput(view)
  var inflated = 0
  while (inflated < raw.size) {
    val got = inflater.inflate(raw, inflated, raw.size - inflated)
    if (got == 0 && (inflater.needsInput() || inflater.finished())) {
      throw IllegalStateException("Block at ${offset} inflated to ${inflated} of ${raw.size} bytes")
    }
    inflated += got
  }
  return Block(raw, data + compressed)
}

/** A sorted stretch of records within one mapping, with each block's first key. */
private class Chunk<K : Comparable<K>>(
    // The whole mapping, which positions are relative to
    val mapping: ByteBuffer,
    val start: Long,
    val end: Long,
    val indexKeys: List<K>,
    // Where each block whose first key is in indexKeys starts in the mapping
    val indexBlocks: IntArray,
) {

  val compressedBytes: Long
    get() = (blockOf(end) - blockOf(start)).toLong()

  fun slice(from: Long, to: Long): Chunk<K> {
    var first = 0
    while (first < indexBlocks.size && indexBlocks[first] < blockOf(from)) {
      first += 1
    }
    var last = first
    while (last < indexBlocks.size && position(indexBlocks[last], 0) < to) {
      last += 1
    }
    return Chunk(
        mapping, from, to, indexKeys.subList(first, last), indexBlocks.copyOfRange(first, last))
  }

  /** Returns where the first record with a key at or past [key] starts, or [end] if none does. */
  fun positionOf(key: K, codec: KeyCodec<K>, grouped: Boolean): Long {
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
    // Every block is indexed, so the first record at or past the key is in the last block that
    // starts before it, or else it starts the next block.
    if (low == 0) {
      return start
    }

    val block = indexBlocks[low - 1]
    val reader = RecordReader(slice(position(block, 0), end), codec, grouped)
    while (reader.advance()) {
      if (reader.compareKeyTo(key) >= 0) {
        return maxOf(start, reader.position)
      }
      if (blockOf(reader.position) != block) {
        break
      }
    }
    return if (reader.exhausted) end else maxOf(start, reader.position)
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
  return chunks.sumOf { it.compressedBytes }
}

/** Reads a chunk's records in order, decompressing a block at a time. */
private class RecordReader<K : Comparable<K>>(
    private val chunk: Chunk<K>,
    private val codec: KeyCodec<K>,
    private val grouped: Boolean,
) {

  var raw = ByteArray(0)
    private set
  private var buffer = ByteBuffer.wrap(raw)
  private var stream = EncodedByteBufferInputStream(buffer, owned = false)
  private var block = -1
  private var nextBlock = blockOf(chunk.start)
  private var previousKey = 0L
  var exhausted = false
    private set

  /** Where the current record starts. */
  var position = chunk.start
    private set
  var longKey = 0L
    private set
  var objectKey: K? = null
    private set
  var count = 1
    private set
  var valueStart = 0
    private set
  var valueLength = 0
    private set

  val key: K
    get() = if (codec.primitive) codec.fromLong(longKey) else objectKey!!

  /** Moves to the next record, returning false once the chunk is spent. */
  fun advance(): Boolean {
    if (exhausted) {
      return false
    }

    if (block < 0) {
      // A chunk can start partway into a block, and decoding a key needs the ones before it.
      openNextBlock()
      while (buffer.position() < offsetOf(chunk.start)) {
        readHeader()
        buffer.position(valueStart + valueLength)
      }
    } else {
      buffer.position(valueStart + valueLength)
    }

    if (!buffer.hasRemaining()) {
      if (nextBlock >= blockOf(chunk.end) && offsetOf(chunk.end) == 0) {
        exhausted = true
        return false
      }
      openNextBlock()
    }

    position = position(block, buffer.position())
    if (position >= chunk.end) {
      exhausted = true
      return false
    }
    readHeader()
    return true
  }

  fun compareKeyTo(other: K): Int {
    return if (codec.primitive) {
      longKey.compareTo(codec.toLong(other))
    } else {
      objectKey!!.compareTo(other)
    }
  }

  /** Returns a stream at the start of the current record's values. */
  fun values(): EncodedInputStream {
    buffer.position(valueStart)
    return stream
  }

  private fun openNextBlock() {
    val read = readBlock(chunk.mapping, nextBlock)
    block = nextBlock
    nextBlock = read.next
    raw = read.raw
    buffer = ByteBuffer.wrap(raw)
    stream = EncodedByteBufferInputStream(buffer, owned = false)
    previousKey = 0L
  }

  private fun readHeader() {
    if (codec.primitive) {
      longKey = previousKey + stream.readVarLong()
      previousKey = longKey
    } else {
      objectKey = codec.serializer.read(stream)
    }
    if (grouped) {
      count = stream.readVarInt()
    }
    valueLength = stream.readVarInt()
    valueStart = buffer.position()
  }
}

/** Reads one run a record at a time for a merge. */
private class RunCursor<K : Comparable<K>>(
    chunk: Chunk<K>,
    private val codec: KeyCodec<K>,
) {

  private val reader = RecordReader(chunk, codec, grouped = false)

  val raw: ByteArray
    get() = reader.raw

  val longKey: Long
    get() = reader.longKey

  val objectKey: K?
    get() = reader.objectKey

  val key: K
    get() = reader.key

  val valueStart: Int
    get() = reader.valueStart

  val valueLength: Int
    get() = reader.valueLength

  /** Moves to the next record, returning false once the run is spent. */
  fun advance(): Boolean {
    return reader.advance()
  }

  fun <V> readValue(serializer: Serializer<V>): V {
    return serializer.read(reader.values())
  }

  fun hasKey(long: Long, obj: K?): Boolean {
    return if (codec.primitive) longKey == long else objectKey!!.compareTo(obj!!) == 0
  }

}

/**
 * Merges runs by key with a tournament of losers. Each internal node holds the run that lost the
 * match played there and the root holds the winner, so replacing the winner replays one match per
 * level against the stored losers. A binary heap's poll and add compare about three times as often,
 * and the comparisons are the bulk of a merge. Ties go to the earlier run, so values for one key
 * come out in a stable order.
 */
private class RunMerger<K : Comparable<K>>(chunks: List<Chunk<K>>, private val codec: KeyCodec<K>) {

  private val cursors = chunks.map { RunCursor(it, codec) }
  private val count = cursors.size
  private val spent = BooleanArray(count)
  // The current key of each run, so primitive keys compare without a call through the cursor
  private val keys = LongArray(count)
  // Index 0 is the winner and 1 until count are the losers. Leaves sit at count until 2 * count, so
  // run i's leaf is count + i.
  private val tree = IntArray(maxOf(count, 1))

  init {
    for (i in 0 until count) {
      load(i, cursors[i].advance())
    }
    if (count > 0) {
      tree[0] = play(1)
    }
  }

  fun hasNext(): Boolean {
    return count > 0 && !spent[tree[0]]
  }

  /**
   * Hands every cursor holding the smallest key to [consume], which reads its value, and returns
   * that key.
   */
  fun nextGroup(consume: (RunCursor<K>) -> Unit): K {
    val first = cursors[tree[0]]
    val key = first.key
    val long = first.longKey
    val obj = first.objectKey
    while (hasNext() && cursors[tree[0]].hasKey(long, obj)) {
      val winner = tree[0]
      consume(cursors[winner])
      load(winner, cursors[winner].advance())
      replay(winner)
    }
    return key
  }

  private fun load(run: Int, present: Boolean) {
    spent[run] = !present
    if (present && codec.primitive) {
      keys[run] = cursors[run].longKey
    }
  }

  /** Plays the matches below [node] and returns their winner, filling in the losers. */
  private fun play(node: Int): Int {
    if (node >= count) {
      return node - count
    }
    val a = play(2 * node)
    val b = play(2 * node + 1)
    return if (beats(a, b)) {
      tree[node] = b
      a
    } else {
      tree[node] = a
      b
    }
  }

  private fun replay(run: Int) {
    var winner = run
    var node = (count + run) ushr 1
    while (node >= 1) {
      val loser = tree[node]
      if (beats(loser, winner)) {
        tree[node] = winner
        winner = loser
      }
      node = node ushr 1
    }
    tree[0] = winner
  }

  // Whether run a's current record comes before run b's. A spent run loses to everything.
  private fun beats(a: Int, b: Int): Boolean {
    if (spent[a]) {
      return false
    }
    if (spent[b]) {
      return true
    }
    val byKey =
        if (codec.primitive) keys[a].compareTo(keys[b])
        else cursors[a].objectKey!!.compareTo(cursors[b].objectKey!!)
    return if (byKey != 0) byKey < 0 else a < b
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
  private var reader: RecordReader<K>? = null
  private var ready = false

  override fun close() {
    onClose?.close()
  }

  override fun estimatedByteSize(): Long {
    return size
  }

  override fun hasNext(): Boolean {
    while (!ready) {
      val current = reader
      if (current != null && current.advance()) {
        ready = true
      } else {
        chunk += 1
        if (chunk >= chunks.size) {
          return false
        }
        reader = RecordReader(chunks[chunk], codec, grouped = true)
      }
    }
    return true
  }

  override fun next(): PEntry<K, V> {
    if (!hasNext()) {
      throw NoSuchElementException()
    }
    ready = false
    val reader = reader!!
    val stream = reader.values()
    val values = ArrayList<V>(reader.count)
    repeat(reader.count) {
      values.add(valueSerializer.read(stream))
    }
    return PEntry(reader.key, values)
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

/** The first key of every block written so far, and where the block starts. */
private class IndexBuilder<K> {

  val keys = ArrayList<K>()
  var offsets = LongArray(1024)
    private set

  fun add(key: K, offset: Long) {
    if (keys.size == offsets.size) {
      offsets = offsets.copyOf(2 * offsets.size)
    }
    offsets[keys.size] = offset
    keys.add(key)
  }
}

/** A growable byte array to build a block in. */
private class RawBuffer : EncodedOutputStream() {

  // Room for a block and the record that overflows it, which is usually small
  var bytes = ByteArray(2 * BLOCK_BYTES)
    private set
  var size = 0
    private set

  override fun write(b: Byte) {
    ensure(1)
    bytes[size] = b
    size += 1
  }

  override fun write(b: ByteArray, off: Int, len: Int) {
    ensure(len)
    System.arraycopy(b, off, bytes, size, len)
    size += len
  }

  fun clear() {
    size = 0
  }

  private fun ensure(more: Int) {
    if (size + more > bytes.size) {
      bytes = bytes.copyOf(maxOf(2 * bytes.size, size + more))
    }
  }
}

/** Packs records into compressed blocks on [output], indexing each block's first key. */
private class BlockWriter<K : Comparable<K>>(
    private val output: ChannelEncodedOutputStream,
    private val codec: KeyCodec<K>,
    private val index: IndexBuilder<K>,
) {

  private val raw = RawBuffer()
  private var compressed = ByteArray(BLOCK_BYTES)
  private var firstKey: K? = null
  private var previousKey = 0L
  var rawBytes = 0L
    private set

  /**
   * Writes a record's key, starting a new block first if the current one is full, and returns the
   * stream the rest of the record goes to. Pass [key] for object keys and [longKey] for primitive
   * ones.
   */
  fun startRecord(key: K?, longKey: Long): EncodedOutputStream {
    if (raw.size >= BLOCK_BYTES) {
      flush()
    }
    if (raw.size == 0) {
      firstKey = key ?: codec.fromLong(longKey)
      previousKey = 0L
    }
    if (codec.primitive) {
      raw.writeVarLong(longKey - previousKey)
      previousKey = longKey
    } else {
      codec.serializer.write(key!!, raw)
    }
    return raw
  }

  /** Writes out the block in progress. A run ends with this so no block spans two runs. */
  fun flush() {
    if (raw.size == 0) {
      return
    }

    val deflater = DEFLATER.get()
    deflater.reset()
    deflater.setInput(raw.bytes, 0, raw.size)
    deflater.finish()
    var length = 0
    while (!deflater.finished()) {
      if (length == compressed.size) {
        compressed = compressed.copyOf(2 * compressed.size)
      }
      length += deflater.deflate(compressed, length, compressed.size - length)
    }

    index.add(firstKey!!, output.nextWriteOffset())
    output.writeVarInt(length)
    output.writeVarInt(raw.size)
    output.write(compressed, 0, length)
    output.checkBufferSpace()
    rawBytes += raw.size
    raw.clear()
  }
}

/** Runs sitting in files, mapped. */
private class Runs<K : Comparable<K>>(
    val files: List<File>,
    val chunks: List<Chunk<K>>,
    private val mappings: List<ByteBuffer>,
    val rawBytes: Long,
) {

  val size = bytesIn(chunks)

  fun unmap() {
    mappings.forEach { EncodedByteBufferInputStream(it).close() }
  }
}

/** Maps each extent of [file] and hands it the index entries of the blocks inside it. */
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
      val blocks = IntArray(entry - from) { (index.offsets[from + it] - extent.start).toInt() }
      chunks.add(
          Chunk(
              mapping,
              position(0, 0),
              position(extent.length.toInt(), 0),
              index.keys.subList(from, entry),
              blocks))
    }
  }
  return Pair(chunks, mappings)
}

/** Records waiting to be sorted into a run. */
private interface RunBuffer<K : Comparable<K>, V> {

  /**
   * Takes the record, or returns false if holding it would go over budget and the buffer should
   * be written out first. An empty buffer always takes it.
   */
  fun add(key: K, value: V): Boolean

  /** Writes everything held in key order and empties the buffer. */
  fun writeSorted(writer: BlockWriter<K>)
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

  override fun writeSorted(writer: BlockWriter<K>) {
    val order = sorter.sort(keys, count)
    for (i in 0 until count) {
      val record = order[i]
      val output = writer.startRecord(null, keys[record])
      output.writeVarInt(lengths[record])
      val location = locations[record]
      output.write(
          arenas[(location ushr 32).toInt()], (location and 0xFFFFFFFFL).toInt(), lengths[record])
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

  override fun writeSorted(writer: BlockWriter<K>) {
    // List.sort is stable, so equal keys keep the order they arrived in.
    items.sort()
    for (item in items) {
      val output = writer.startRecord(item.key, 0L)
      output.writeVarInt(item.value.size)
      output.write(item.value)
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
  private val blocks = BlockWriter(output, codec, index)

  val rawBytes: Long
    get() = blocks.rawBytes

  fun emit(key: K, value: V) {
    if (!buffer.add(key, value)) {
      dump()
      check(buffer.add(key, value))
    }
  }

  private fun dump() {
    buffer.writeSorted(blocks)
    blocks.flush()
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
  val runs = Runs(listOf(file), chunks, mappings, writer.rawBytes)
  println(
      "  PMap (mmap) ${keyType} -> ${valueType} in ${chunks.size} shards" +
          " (size ${runs.size}, raw ${runs.rawBytes})")
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
  val runs = Runs(writers.map { it.file }, chunks, mappings, writers.sumOf { it.rawBytes })
  println(
      "  PMap (mmap parallel x${workers}) ${keyType} -> ${valueType} in ${chunks.size} shards" +
          " (size ${runs.size}, raw ${runs.rawBytes})")
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
  val rawBytes = LongArray(parts.size)
  val failure = AtomicReference<Throwable>()

  longProgress("${context} merging shards") { progress ->
    val threads =
        parts.indices.map { p ->
          Thread(
              {
                try {
                  val index = IndexBuilder<K>()
                  val (written, raw) =
                      mergeInto(files[p], parts[p], codec, index) { progress.incrementBy(it) }
                  extents[p] = written
                  rawBytes[p] = raw
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
  println(
      "  PMap (mmap) ${keyType} -> ${valueType} size ${size}, raw ${rawBytes.sum()}" +
          " (index ${entries})")

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

/**
 * Merges [chunks] into [file] as grouped records, copying value bytes without decoding them, and
 * returns the file's extents and how many bytes the blocks held before compression.
 */
private fun <K : Comparable<K>> mergeInto(
    file: File,
    chunks: List<Chunk<K>>,
    codec: KeyCodec<K>,
    index: IndexBuilder<K>,
    progress: (Int) -> Unit): Pair<List<Extents>, Long> {
  RandomAccessFile(file, "rw").use { raf ->
    val output = ChannelEncodedOutputStream(raf.channel)
    val blocks = BlockWriter(output, codec, index)
    output.use {
      val merger = RunMerger(chunks, codec)
      var raws = arrayOfNulls<ByteArray>(16)
      var starts = IntArray(16)
      var lengths = IntArray(16)
      while (merger.hasNext()) {
        var count = 0
        var total = 0
        var longKey = 0L
        val key = merger.nextGroup {
          if (count == raws.size) {
            raws = raws.copyOf(2 * count)
            starts = starts.copyOf(2 * count)
            lengths = lengths.copyOf(2 * count)
          }
          raws[count] = it.raw
          starts[count] = it.valueStart
          lengths[count] = it.valueLength
          total += it.valueLength
          longKey = it.longKey
          count += 1
        }

        val record =
            if (codec.primitive) blocks.startRecord(null, longKey) else blocks.startRecord(key, 0L)
        record.writeVarInt(count)
        record.writeVarInt(total)
        for (i in 0 until count) {
          record.write(raws[i]!!, starts[i], lengths[i])
        }
        progress(count)
      }
      blocks.flush()
    }
    return Pair(output.shards(), blocks.rawBytes)
  }
}
