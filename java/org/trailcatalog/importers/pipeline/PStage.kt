package org.trailcatalog.importers.pipeline

abstract class PStage<I, O> {

  abstract fun act(input: I): () -> O

  protected open fun estimateCount(): Long {
    return 0
  }

  protected open fun estimateElementBytes(): Long {
    return 0
  }

  protected open fun estimateRatio(): Double {
    return 0.0
  }

  protected fun estimateSize(inputSize: Long): Long {
    return (estimateRatio() * inputSize).toLong() + estimateCount() * estimateElementBytes()
  }
}
