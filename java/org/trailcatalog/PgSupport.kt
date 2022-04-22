package org.trailcatalog

import com.zaxxer.hikari.HikariConfig
import com.zaxxer.hikari.HikariDataSource
import java.sql.Connection

fun createConnectionSource(): HikariDataSource {
  return HikariDataSource(HikariConfig().apply {
    val envUrl = System.getenv("DATABASE_URL")
    jdbcUrl = when (envUrl) {
      null -> "jdbc:postgresql://10.110.231.203:5432/trailcatalog?currentSchema=migration_1_create_geometry"
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

fun withTempTables(wrapping: List<String>, connection: Connection, fn: () -> Unit) {
  for (table in wrapping) {
    connection.createStatement().execute(
        "CREATE TEMP TABLE tmp_${table} (LIKE ${table} INCLUDING DEFAULTS) ON COMMIT DROP")
  }

  fn.invoke()

  for (table in wrapping) {
    println("Copying from tmp_${table} to ${table}")
    connection.createStatement().execute(
        "INSERT INTO ${table} SELECT * FROM tmp_${table} ON CONFLICT DO NOTHING")
  }

  connection.commit()
}
