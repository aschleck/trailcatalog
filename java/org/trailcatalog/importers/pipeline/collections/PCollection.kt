package org.trailcatalog.importers.pipeline.collections

interface PCollection<T> : Iterator<T> {

  fun estimatedByteSize(): Long
}
