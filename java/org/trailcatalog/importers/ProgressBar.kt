package org.trailcatalog.importers

import java.io.Closeable

class ProgressBar(private val action: String, private val units: String) : Closeable {

  private var active = true
  private var count = 0
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
    count += 1
  }

  private fun message(): String {
    synchronized (count) {
      return "${action}: ${count} ${units} " +
          "(%.2f ${units}/second)".format(count * 1000.0 / (System.currentTimeMillis() - start))
    }
  }
}
