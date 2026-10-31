package org.trailcatalog

import com.zaxxer.hikari.HikariDataSource
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneOffset

public class EpochTracker(private val hikari: HikariDataSource) {

  @Volatile var epoch: Int = 0

  init {
    Thread {
      while (true) {
        hikari.connection.use {
          it.prepareStatement("SELECT epoch FROM active_epoch ORDER BY epoch DESC LIMIT 1").use {
            val results = it.executeQuery()
            if (results.next()) {
              epoch = results.getInt(1)
            } else {
              println("Unable to find an epoch")
            }
          }
        }

        Thread.sleep(10_000)
      }
    }.start()
  }
}

/**
 * Returns the date the import's data is from as YYMMDD, followed by two digits counting the
 * imports already made of that date.
 */
fun chooseEpoch(activeEpochs: Set<Int>): Int {
  val now = LocalDateTime.now(ZoneOffset.UTC)
  if (now.hour < 1 && now.minute < 15) {
    throw RuntimeException("Don't do this")
  }
  // TODO(april): roll back month
  val date = (now.year % 100) * 10000 + now.month.value * 100 + (now.dayOfMonth - 1)
  val first = date * 100
  val sameDate = activeEpochs.filter { it in first until first + 100 }
  val next = if (sameDate.isEmpty()) first else sameDate.max() + 1
  // Finishing drops every epoch but the new one, so it has to sort after the live one too.
  return maxOf(next, (activeEpochs.maxOrNull() ?: 0) + 1)
}

/** Returns the date an epoch's data is from. */
fun epochDate(epoch: Int): LocalDate {
  // Six digit epochs predate the import counter.
  val yymmdd = if (epoch >= 1_000_000) epoch / 100 else epoch
  return LocalDate.of(2000 + yymmdd / 100_00, yymmdd / 100 % 100, yymmdd % 100 + 1)
}
