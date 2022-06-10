package org.trailcatalog.importers.pipeline.collections

import java.io.File
import java.util.concurrent.atomic.AtomicInteger

data class FileReference(private val file: File, private val active: AtomicInteger) {

  fun close() {
    if (active.decrementAndGet() == 0) {
      file.delete()
    }
  }
}