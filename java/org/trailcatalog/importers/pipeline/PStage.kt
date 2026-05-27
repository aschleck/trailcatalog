package org.trailcatalog.importers.pipeline

import org.trailcatalog.importers.pipeline.collections.DisposableSupplier

abstract class PStage<I, O> {

  abstract fun act(input: I, dependants: Int): DisposableSupplier<O>

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

  /**
   * Maximum worker threads this stage can usefully spread its act() loop across.
   *
   * The default of 1 keeps each stage single-threaded — the current behavior. Stages whose act()
   * is cheap (a few comparisons, a hash lookup, an emit) leave this at 1 because dispatch
   * overhead would dominate. Stages whose act() is expensive (S2 polygon assembly, trail
   * orient/trace, DEM lookups) override it to fan out.
   *
   * The actual worker count is min(this, pipeline.parallelism), so the CLI flag is an overall
   * cap, and any stage with known in-memory hotspots (CreateBoundariesInBoundaries,
   * CreateTrailsInBoundaries, ExtractRelationGeometriesWithWays) leaves this at 1 so it doesn't
   * multiply heap usage.
   */
  open val parallelism: Int = 1

  /**
   * Worker-thread count actually granted to this stage for the current invocation. Set by
   * [BoundStage.invoke] right before it calls [act], so subclasses can read it from inside
   * act() without needing to thread the Pipeline through. Equal to
   * `min(this.parallelism, pipeline.parallelism)`.
   */
  protected var resolvedParallelism: Int = 1
    private set

  internal fun setResolvedParallelism(value: Int) {
    resolvedParallelism = value
  }
}
