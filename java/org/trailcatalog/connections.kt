package org.trailcatalog

import com.zaxxer.hikari.HikariConfig
import com.zaxxer.hikari.HikariDataSource

fun createConnectionSource(): HikariDataSource {
  return HikariDataSource(HikariConfig().apply {
    val envUrl = System.getenv("DATABASE_URL")
    jdbcUrl = when (envUrl) {
      null -> "jdbc:postgresql://10.110.231.203:5432/trailcatalog?currentSchema=migration_3_dont_use_enum"
      else -> "jdbc:$envUrl"
    }
    val envUser = System.getenv("DATABASE_USERNAME_PASSWORD")
    if (envUser == null) {
      username = "postgres"
      password = "postgres"
    } else {
      val split = envUser.split(':', limit = 2)
      username = split[0]
      password = split[1]
    }
  })
}
