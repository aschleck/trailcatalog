package org.trailcatalog.importers

import java.io.Closeable

class ProgressBar(
  private val action: String,
  private val units: String,
  private val limit: Number = -1.0) : Closeable {

  private var active = true
  @Volatile private var count = 0.0
  private val start = System.currentTimeMillis() - 1

  init {
    print(message())
    Thread {
      var running = true
      while (running) {
        Thread.sleep(500)

        synchronized (active) {
          if (active) {
            print("\r${message()}")
          } else {
            running = false
          }
        }
      }
    }.start()
  }

  override fun close() {
    synchronized (active) {
      active = false
      println("\rFinished ${message()}")
    }
  }

  fun increment() {
    incrementBy(1)
  }

  fun incrementBy(amount: Number) {
    synchronized (count) {
      count = count.plus(amount.toDouble())
    }
  }

  private fun message(): String {
    synchronized (count) {
      val roundCount = "%.2f".format(count)
      val progress = if (limit.toDouble() >= 0) "${roundCount}/${limit}" else roundCount
      return "${action}: ${progress} ${units} " +
          "(%.2f ${units}/second)".format(count * 1000.0 / (System.currentTimeMillis() - start))
    }
  }
}
