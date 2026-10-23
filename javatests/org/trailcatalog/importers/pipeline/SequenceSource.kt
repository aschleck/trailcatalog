package org.trailcatalog.importers.pipeline

import com.google.common.reflect.TypeToken

class SequenceSource<T : Any>(type: TypeToken<out T>, private val sequence: Sequence<T>)
  : PSource<T>(type) {

  override fun read(): Sequence<T> = sequence
}

inline fun <reified T : Any> SequenceSource(sequence: Sequence<T>): SequenceSource<T> =
    SequenceSource(object : TypeToken<T>() {}, sequence)
