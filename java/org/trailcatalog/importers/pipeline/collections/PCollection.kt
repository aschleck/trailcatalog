package org.trailcatalog.importers.pipeline.collections

import java.io.Closeable

interface PCollection<T> : Closeable, Iterator<T> {

  fun estimatedByteSize(): Long
}

/** A collection that can be cut into pieces read on separate threads. */
interface Partitionable<T> : PCollection<T> {

  /**
   * Cuts this into at most [parts] pieces that together hold everything. Only valid before
   * anything has been read. Closing the pieces does nothing; closing this closes them.
   */
  fun partition(parts: Int): List<PCollection<T>>
}
