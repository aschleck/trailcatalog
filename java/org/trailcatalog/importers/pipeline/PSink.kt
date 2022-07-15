package org.trailcatalog.importers.pipeline

import org.trailcatalog.importers.pipeline.collections.DisposableSupplier

abstract class PSink<T : Any> : PStage<T, Void?>() {

  abstract fun write(input: T)

  final override fun act(input: T): DisposableSupplier<Void?> {
    println("Sinking ${this::class.simpleName}")
    write(input)
    return DisposableSupplier({}) {
      null
    }
  }
}