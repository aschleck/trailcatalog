package org.trailcatalog.importers.pipeline.collections

import org.trailcatalog.importers.pipeline.io.EncodedInputStream
import org.trailcatalog.importers.pipeline.io.EncodedOutputStream

interface Serializer<T> {
  fun read(from: EncodedInputStream): T
  fun size(v: T): Int
  fun write(v: T, to: EncodedOutputStream)
}
