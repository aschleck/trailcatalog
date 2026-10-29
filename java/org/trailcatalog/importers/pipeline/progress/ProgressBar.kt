package org.trailcatalog.importers.pipeline.progress

import java.io.Closeable
import java.util.concurrent.atomic.LongAdder

// Without a terminal \r doesn't return to the start of the line, so every redraw would pile onto
// one line.
private val INTERACTIVE = System.console() != null
private const val UNATTENDED_INTERVAL_MS = 30_000

fun longProgress(context: String, fn: (progress: ProgressBar) -> Unit) {
  ProgressBar(context, "items").use {
    fn(it)
  }
}

class ProgressBar(
    private val action: String,
    private val units: String,
    limit: Number = -1) : Closeable {

  private val limit = limit.toLong()
  private val count = LongAdder()
  private val lock = Object()
  private val start = System.currentTimeMillis()
  private var active = true

  init {
    Thread {
      var running = true
      var lastPrint = start
      while (running) {
        Thread.sleep(500)

        synchronized (lock) {
          val now = System.currentTimeMillis()
          if (!active) {
            running = false
          } else if (INTERACTIVE) {
            print("\r${message()}")
          } else if (now - lastPrint >= UNATTENDED_INTERVAL_MS) {
            println(message())
            lastPrint = now
          }
        }
      }
    }.start()
  }

  override fun close() {
    synchronized (lock) {
      active = false
    }
    val finished = "Finished ${message()}"
    println(if (INTERACTIVE) "\r${finished}" else finished)
  }

  fun increment() {
    count.increment()
  }

  fun incrementBy(amount: Number) {
    count.add(amount.toLong())
  }

  private fun message(): String {
    val totalMs = System.currentTimeMillis() - start
    val totalSeconds = totalMs / 1000
    val secondsPerHour = 60 * 60
    val hours = totalSeconds / secondsPerHour
    val minutes = (totalSeconds % secondsPerHour) / 60
    val seconds = totalSeconds % 60
    val duration = if (hours >= 1) {
      "${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}"
    } else if (minutes >= 1) {
      "${minutes}:${seconds.toString().padStart(2, '0')}"
    } else {
      "${seconds}s"
    }

    val c = count.sum()
    val progress = if (limit >= 0) "${c}/${limit}" else c.toString()
    val perSecond = (c * 1000.0 / maxOf(totalMs, 1)).toLong()
    return "${action}: ${progress} ${units} (${perSecond} ${units}/s, ${duration})"
  }
}
