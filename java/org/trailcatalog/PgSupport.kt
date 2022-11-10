package org.trailcatalog

import com.zaxxer.hikari.HikariConfig
import com.zaxxer.hikari.HikariDataSource

fun createConnectionSource(maxSize: Int = -1, syncCommit: Boolean = true): HikariDataSource {
  return HikariDataSource(HikariConfig().apply {
    val envUrl = System.getenv("DATABASE_URL")
    jdbcUrl = when (envUrl) {
      null ->
        "jdbc:postgresql://127.0.0.1:5432/trailcatalog?currentSchema=migration_3_drop_geofabrik"
      else -> "jdbc:$envUrl"
    }
    val envUser = System.getenv("DATABASE_USERNAME_PASSWORD")
    if (envUser == null) {
      username = "trailcatalog"
      password = "trailcatalog"
    } else {
      val split = envUser.split(':', limit = 2)
      username = split[0]
      password = split[1]
    }

    if (maxSize > 0) {
      maximumPoolSize = maxSize
    }

    if (!syncCommit) {
      connectionInitSql = "SET SESSION synchronous_commit TO OFF"
    }
  })
}
