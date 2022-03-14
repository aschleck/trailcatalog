package org.trailcatalog.pbf

import com.wolt.osm.parallelpbf.blob.BlobInformation
import com.wolt.osm.parallelpbf.blob.BlobReader
import crosby.binary.Fileformat
import crosby.binary.Osmformat.PrimitiveBlock
import java.io.InputStream
import java.util.Optional
import java.util.zip.Inflater

class PbfBlockReader(private val input: InputStream) {

  fun readBlocks() = sequence {
    val reader = BlobReader(input)
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