package org.trailcatalog

import com.zaxxer.hikari.HikariConfig
import com.zaxxer.hikari.HikariDataSource

fun createConnectionSource(maxSize: Int = -1, syncCommit: Boolean = true): HikariDataSource {
  return HikariDataSource(HikariConfig().apply {
    jdbcUrl = "jdbc:" + System.getenv("DATABASE_URL")!!
    val envUser = System.getenv("DATABASE_USERNAME_PASSWORD")!!
    val split = envUser.split(':', limit = 2)
    username = split[0]
    password = split[1]

    if (maxSize > 0) {
      maximumPoolSize = maxSize
    }

    if (!syncCommit) {
      connectionInitSql = "SET SESSION synchronous_commit TO OFF"
    }
  })
}
