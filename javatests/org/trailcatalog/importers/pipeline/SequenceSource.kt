package org.trailcatalog.importers.pipeline

class SequenceSource<T : Any>(private val sequence: Sequence<T>) : PSource<T>() {

  override fun read(): Sequence<T> = sequence
}