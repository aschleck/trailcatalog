package org.trailcatalog.importers.pipeline.progress

import java.io.Closeable
import java.util.concurrent.atomic.AtomicLong

fun longProgress(context: String, fn: (progress: LongProgress) -> Unit) {
  val progress = LongProgress()
  ProgressBar(context, progress).use {
    fn(progress)
  }
}

private class ProgressBar(private val context: String, private val progress: Progress) : Closeable {

  private val lock = Object()
  private val start = System.currentTimeMillis()
  private var active = true

  init {
    Thread {
      var running = true
      while (running) {
        Thread.sleep(500)

        synchronized (lock) {
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
    synchronized (lock) {
      active = false
    }
    println("\r${message()}")
  }

  private fun message(): String {
    val now = System.currentTimeMillis()
    val totalMs = now - start
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
      seconds.toString()
    }

    val pps = progress.progressPerSecond(totalMs / 1000.0)
    return "${context}: ${progress.totalProgress()} (${pps}/s, ${duration})"
  }
}

interface Progress {
  fun totalProgress(): String
  fun progressPerSecond(seconds: Double): String
}

class LongProgress : Progress {

  private val value = AtomicLong(0)

  fun increment() {
    value.incrementAndGet()
  }

  fun incrementBy(count: Int) {
    value.addAndGet(count.toLong())
  }

  fun incrementBy(count: Long) {
    value.addAndGet(count)
  }

  override fun totalProgress(): String {
    return value.get().toString()
  }

  override fun progressPerSecond(seconds: Double): String {
    return (value.get() / seconds).toLong().toString()
  }
}