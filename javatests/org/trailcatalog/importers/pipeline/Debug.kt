package org.trailcatalog.importers.pipeline

import org.trailcatalog.importers.pipeline.collections.PCollection

class Debug<T : PCollection<*>> : PSink<T>() {

  val values = ArrayList<String>()

  override fun write(input: T) {
    while (input.hasNext()) {
      values.add(input.next().toString())
    }
    input.close()
  }
}