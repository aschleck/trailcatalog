package org.trailcatalog.importers.pipeline

abstract class PSink<T : Any> : PStage<T, Void?>() {

  abstract fun write(input: T)

  final override fun act(input: T): () -> Void? {
    return {
      println("writing sink ${this::class.simpleName}")
      write(input)
      null
    }
  }
}