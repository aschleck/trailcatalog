package org.trailcatalog.importers.pipeline.collections

import java.io.Closeable

class DisposableSupplier<out V>(private val disposer: Closeable, private val value: () -> V)
  : Closeable {

  fun invoke(): V {
    return value.invoke()
  }

  override fun close() {
    disposer.close()
  }
}