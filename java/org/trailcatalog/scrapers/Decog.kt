package org.trailcatalog.scrapers

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import org.trailcatalog.common.EncodedByteBufferInputStream
import org.trailcatalog.common.EncodedInputStream
import org.trailcatalog.common.TiffDataType
import org.trailcatalog.common.TiffTagType
import org.trailcatalog.importers.common.IORuntimeException
import org.trailcatalog.importers.pipeline.io.ByteBufferEncodedOutputStream
import org.trailcatalog.importers.pipeline.io.ChannelEncodedOutputStream
import java.io.InputStream
import java.lang.UnsupportedOperationException
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.channels.FileChannel
import java.nio.file.Path
import java.nio.file.StandardOpenOption

fun main(args: Array<String>) {
  val url = args[0].toHttpUrl()
  val destination = args[1]

  FileChannel.open(
          Path.of(destination),
          StandardOpenOption.CREATE,
          StandardOpenOption.TRUNCATE_EXISTING,
          StandardOpenOption.WRITE)
      .use { channel ->
        downloadCog(
            EncodedUrlInputStream(SeekingUrlInputStream(url)),
            ChannelEncodedOutputStream(channel))
      }
}

private fun downloadCog(stream: EncodedUrlInputStream, destination: ChannelEncodedOutputStream) {
  val firstBytes = ByteArray(16 * 1024)
  val firstBytesStream = EncodedByteBufferInputStream(ByteBuffer.wrap(firstBytes))
  stream.read(firstBytes)

  if (firstBytesStream.readUShort() != 0x4949.toUShort()) {
    throw IllegalArgumentException("Tiff does not appear to be in little-endian")
  }
  destination.writeShort(0x4949)
  if (firstBytesStream.readUShort() != 0x2A.toUShort()) {
    throw IllegalArgumentException("Tiff does not appear to be in little-endian")
  }
  destination.writeShort(0x2A)
  destination.flush()
  val destOffset = (destination.position() + 4).toUInt() // Data starts after IFD offset (4 bytes)

  var ifdPosition = firstBytesStream.readUInt().toLong()
  val ifds = ArrayList<Ifd>()
  while (ifdPosition > 0) {
    val ifd = if (ifdPosition < firstBytes.size) {
      firstBytesStream.seek(ifdPosition.toUInt())
      readIfd(firstBytesStream)
    } else {
      stream.seek(ifdPosition.toUInt())
      readIfd(stream)
    }

    ifds.add(ifd)
    ifdPosition = ifd.nextIfd.toLong()
  }

  ifds.sortByDescending { it.imageHeight }
  val largest = ifds.first()

  val listItems = HashMap<UShort, ByteArray>()
  for (entry in largest.entries.sortedBy { it.valueOffset }) {
    val size = getItemSize(entry)

    if (entry.valueCount.toInt() * size <= 4) {
      continue
    }

    if (entry.tag == TiffTagType.TileByteCounts.id) {
      if (size != 4) {
        throw IllegalArgumentException("Expected counts as integers")
      }
    }
    else if (entry.tag == TiffTagType.TileOffsets.id) {
      if (size != 4) {
        throw IllegalArgumentException("Expected offsets as integers")
      }
    }

    val array = ByteArray(size * entry.valueCount.toInt())
    if (entry.valueOffset < firstBytes.size.toUInt()) {
      firstBytesStream.seek(entry.valueOffset)
      firstBytesStream.readExactly(array, 0, array.size)
    } else {
      stream.seek(entry.valueOffset)
      stream.readExactly(array, 0, array.size)
    }
    listItems[entry.tag] = array
  }

  val buffer = ByteBuffer.allocate(256 * 1024 * 1024).order(ByteOrder.LITTLE_ENDIAN)

  val tileByteOffsets =
      ByteBuffer.wrap(listItems[TiffTagType.TileOffsets.id]!!)
          .order(ByteOrder.LITTLE_ENDIAN)
          .asIntBuffer()
  val tileByteSizes =
      ByteBuffer.wrap(listItems[TiffTagType.TileByteCounts.id]!!)
          .order(ByteOrder.LITTLE_ENDIAN)
          .asIntBuffer()
  val newTileByteOffsets =
      ByteBuffer.allocate(4 * tileByteOffsets.limit()).order(ByteOrder.LITTLE_ENDIAN)
  val newTileByteInts = newTileByteOffsets.asIntBuffer()
  for (tile in 0 until tileByteOffsets.limit()) {
    stream.seek(tileByteOffsets.get().toUInt())

    newTileByteInts.put(destOffset.toInt() + buffer.position())
    val size = tileByteSizes.get()
    stream.readExactly(buffer.array(), buffer.arrayOffset() + buffer.position(), size)
    buffer.position(buffer.position() + size)
  }
  listItems[TiffTagType.TileOffsets.id] = newTileByteOffsets.array()

  val output = ByteBufferEncodedOutputStream(buffer)
  val copied = ArrayList<IfdEntry>()
  for (entry in largest.entries) {
    if (listItems.contains(entry.tag)) {
      copied.add(IfdEntry(entry.tag, entry.type, entry.valueCount, destOffset + buffer.position().toUInt()))
      output.write(listItems[entry.tag]!!)
    } else if (getItemSize(entry) * entry.valueCount.toInt() <= 4) {
      copied.add(entry)
    }
  }

  buffer.flip()
  destination.writeUInt(destOffset + buffer.limit().toUInt()) // write offset of the IFD
  destination.write(buffer)
  destination.writeUShort(copied.size.toUShort())
  for (entry in copied) {
    destination.writeUShort(entry.tag)
    destination.writeUShort(entry.type)
    destination.writeUInt(entry.valueCount)
    destination.writeUInt(entry.valueOffset)
  }
  destination.writeInt(0) // no more IFDs
  destination.flush()
}

private data class IfdEntry(val tag: UShort, val type: UShort, val valueCount: UInt, val valueOffset: UInt)
private data class Ifd(val entries: List<IfdEntry>, val nextIfd: UInt) {

  val imageHeight
    get() = run {
      val entry = entries.firstOrNull { it.tag == TiffTagType.ImageHeight.id }
      entry?.valueOffset?.toInt()
    }
}

private fun getItemSize(entry: IfdEntry): Int {
  return when (entry.type) {
    TiffDataType.Ascii.id -> 1
    TiffDataType.Double.id -> 8
    TiffDataType.Float.id -> 4
    TiffDataType.UByte.id -> 1
    TiffDataType.UInt.id -> 4
    TiffDataType.UShort.id -> 2
    else -> throw IllegalArgumentException("Unknown type ${entry.type}")
  }
}

private fun readIfd(stream: EncodedInputStream): Ifd {
  val directorySize = stream.readUShort()
  val entries = ArrayList<IfdEntry>()
  for (i in 0 until directorySize.toInt()) {
    val tag = stream.readUShort()
    val type = stream.readUShort()
    val valueCount = stream.readUInt()
    val valueOffset = stream.readUInt()
    entries.add(IfdEntry(tag, type, valueCount, valueOffset))
  }

  return Ifd(entries, stream.readUInt())
}

private class SeekingUrlInputStream(private val url: HttpUrl) : InputStream() {

  private val client = OkHttpClient()
  private var current: InputStream? = null
  private var start = 0L

  override fun close() {
    current?.close()
    current = null
  }

  override fun read(): Int {
    return ensureOpen().read()
  }

  override fun read(b: ByteArray, off: Int, len: Int): Int {
    return ensureOpen().read(b, off, len)
  }

  fun seek(to: Long) {
    close()
    start = to
  }

  private fun ensureOpen(): InputStream {
    val now = current ?: run {
      val response = client.newCall(
          Request.Builder()
              .get()
              .url(url)
              .header("Range", "bytes=$start-")
              .build()
      ).execute()
      if (!response.isSuccessful) {
        throw IORuntimeException("Unable to fetch $url")
      }
      response.body!!.byteStream()
    }
    current = now
    return now
  }
}

private class EncodedUrlInputStream(private val source: SeekingUrlInputStream) : EncodedInputStream() {

  private var position = 0L

  override fun position(): Int {
    return position.toInt()
  }

  override fun readUnsafe(): Byte {
    position += 1
    return source.read().toByte()
  }

  override fun seek(position: UInt) {
    val to = position.toLong()
    if (this.position <= to && to - this.position < 64 * 1024) {
      while (this.position < to) {
        val skipped = source.skip(to - this.position)
        this.position += skipped
      }
    } else {
      this.position = to
      source.seek(to)
    }
  }

  override fun size(): Int {
    throw UnsupportedOperationException()
  }

  override fun read(b: ByteArray, off: Int, len: Int): Int {
    val got = source.read(b, off, len)
    position += got
    return got
  }

  override fun close() {
    source.close()
  }
}
