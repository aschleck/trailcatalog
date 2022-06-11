package org.trailcatalog.importers.pipeline

import java.util.concurrent.atomic.AtomicInteger

abstract class PSink<T : Any> : PStage<T, Void?>() {

  abstract fun write(input: T)

  final override fun act(input: T, handles: AtomicInteger): () -> Void? {
    println("Sinking ${this::class.simpleName}")
    return {
      write(input)
      null
    }
  }
}