package org.trailcatalog.importers.pipeline.collections

import java.nio.ByteBuffer

interface Serializer<T> {
  fun read(from: ByteBuffer): T
  fun write(v: T, to: ByteBuffer)
}