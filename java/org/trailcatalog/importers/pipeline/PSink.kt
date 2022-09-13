package org.trailcatalog.importers.pipeline

import org.trailcatalog.importers.pipeline.collections.DisposableSupplier
import org.trailcatalog.importers.pipeline.progress.longProgress

abstract class PSink<T : Any> : PStage<T, Void?>() {

  abstract fun write(input: T)

  final override fun act(input: T, dependants: Int): DisposableSupplier<Void?> {
    longProgress("Sinking ${this::class.simpleName}") { _ ->
      write(input)
    }
    return DisposableSupplier({}) {
      null
    }
  }
}
