package org.trailcatalog.importers.pipeline.collections

import org.trailcatalog.common.EncodedInputStream
import org.trailcatalog.common.EncodedOutputStream

interface Serializer<T> {
  fun read(from: EncodedInputStream): T
  fun write(v: T, to: EncodedOutputStream)
}
