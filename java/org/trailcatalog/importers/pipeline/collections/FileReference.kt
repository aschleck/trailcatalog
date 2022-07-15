package org.trailcatalog.importers.pipeline.collections

import java.io.Closeable
import java.io.File

data class FileReference(private val file: File) : Closeable {

  override fun close() {
    file.delete()
  }
}