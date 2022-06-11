package org.trailcatalog

import com.zaxxer.hikari.HikariDataSource

class EpochTracker(private val hikari: HikariDataSource) {

  @Volatile var epoch: Int = 0

  init {
    Thread {
      while (true) {
        hikari.connection.use {
          it.prepareStatement("SELECT epoch FROM active_epoch ORDER BY epoch DESC LIMIT 1").use {
            val results = it.executeQuery()
            results.next()
            epoch = results.getInt(1)
          }
        }

        Thread.sleep(10_000)
      }
    }.start()
  }
}