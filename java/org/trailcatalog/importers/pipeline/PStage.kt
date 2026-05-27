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
   * Defaults to `Int.MAX_VALUE` — stages opt *out* of parallelism, not in. The actual worker
   * count is `min(this, pipeline.parallelism)`, so the `--parallelism` CLI flag is the overall
   * cap. Stages override this to a smaller value (usually 1) when:
   *
   *   - The in-memory working set scales with per-key value count (CreateBoundariesInBoundaries,
   *     CreateTrailsInBoundaries) — N workers means N hot keys resident at once, which can OOM.
   *   - act() touches shared mutable state with unclear thread safety (CalculateWayElevations
   *     and its DemResolver).
   *
   * Everything else uses workers freely. The per-record serialization cost on the hot path is
   * non-trivial even for "cheap" stages, so dispatch overhead is comfortably amortized at the
   * 1024-item batch size used by the worker queue.
   */
  open val parallelism: Int = Int.MAX_VALUE

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
