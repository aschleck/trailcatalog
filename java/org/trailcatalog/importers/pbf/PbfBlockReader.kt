package org.trailcatalog.importers.pbf

import com.wolt.osm.parallelpbf.blob.BlobInformation
import com.wolt.osm.parallelpbf.blob.BlobReader
import crosby.binary.Fileformat
import crosby.binary.Osmformat.PrimitiveBlock
import org.trailcatalog.importers.pipeline.PSource
import java.nio.file.Files
import java.nio.file.Path
import java.util.Optional
import java.util.zip.Inflater
import kotlin.io.path.inputStream

class PbfBlockReader(private val path: Path) : PSource<PrimitiveBlock>() {

  override fun estimateCount(): Long {
    return Files.size(path) / estimateElementBytes()
  }

  override fun estimateElementBytes(): Long {
    return 50_000
  }

  override fun read() = sequence {
    val reader = BlobReader(path.inputStream())
    var maybeInformation: Optional<BlobInformation>
    do {
      maybeInformation = reader
          .readBlobHeaderLength()
          .flatMap { length ->
            reader.readBlobHeader(length)
          }
      val maybeBlock =
          maybeInformation
              .flatMap { information ->
                when (information.type) {
                  BlobInformation.TYPE_OSM_DATA -> reader.readBlob(information.size)
                  else -> {
                    reader.skip(information.size)
                    Optional.empty()
                  }
                }
              }
              .map { data ->
                val blob = Fileformat.Blob.parseFrom(data)
                val payload = when {
                  blob.hasZlibData() -> {
                    val inflater = Inflater()
                    inflater.setInput(blob.zlibData.toByteArray())
                    val decompressed = ByteArray(blob.rawSize)
                    val size = inflater.inflate(decompressed)
                    if (size != decompressed.size) {
                      throw IllegalStateException("Payload size mismatch: $size vs ${decompressed.size}")
                    } else {
                      decompressed
                    }
                  }
                  blob.hasRaw() -> blob.raw.toByteArray()
                  else -> throw AssertionError("Unknown type of blob")
                }
                PrimitiveBlock.parseFrom(payload)
              }
      if (maybeBlock.isPresent) {
        yield(maybeBlock.get())
      }
    } while (maybeInformation.isPresent)
  }
}