package org.trailcatalog.importers.pipeline.collections

import com.google.common.reflect.TypeToken
import java.util.concurrent.atomic.AtomicInteger

interface PList<T> : PCollection<T>

fun <T : Any> createPList(
    type: TypeToken<out T>,
    estimatedByteSize: Long,
    handles: AtomicInteger,
    fn: (Emitter<T>,
    ) -> Unit): () -> PList<T> {
  return createMmapPList(type, handles, fn)
}
