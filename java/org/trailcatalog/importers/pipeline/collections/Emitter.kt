package org.trailcatalog.importers.pipeline.collections

interface Emitter<T> {

  fun emit(v: T)
}

interface Emitter2<A, B> {

  fun emit(a: A, b: B)
}
