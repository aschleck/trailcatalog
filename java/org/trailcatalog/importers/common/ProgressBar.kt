package org.trailcatalog.importers.common

import com.google.common.util.concurrent.AtomicDouble
import java.io.Closeable

class ProgressBar(
  private val action: String,
  private val units: String,
  private val limit: Number = -1.0) : Closeable {

  @Volatile private var active = true
  private val count = AtomicDouble(0.0)
  private val start = System.currentTimeMillis() - 1

  init {
    print(message())
    Thread {
      var running = true
      while (running) {
        Thread.sleep(500)

        if (active) {
          print("\r${message()}")
        } else {
          running = false
        }
      }
    }.start()
  }

  override fun close() {
    active = false
    println("\rFinished ${message()} in ${(System.currentTimeMillis() - start) / 1000.0} seconds")
  }

  fun increment() {
    incrementBy(1)
  }

  fun incrementBy(amount: Number) {
    count.addAndGet(amount.toDouble())
  }

  private fun message(): String {
    val c = count.get()
    val roundCount = "%.2f".format(c)
    val progress = if (limit.toDouble() >= 0) "${roundCount}/${limit}" else roundCount
    return "${action}: ${progress} ${units} " +
        "(%.2f ${units}/second)".format(c * 1000.0 / (System.currentTimeMillis() - start))
  }
}
