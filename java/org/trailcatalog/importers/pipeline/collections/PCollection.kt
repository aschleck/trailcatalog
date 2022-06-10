package org.trailcatalog.importers.pipeline.collections

import java.io.Closeable

interface PCollection<T> : Closeable, Iterator<T> {

  fun estimatedByteSize(): Long
}
