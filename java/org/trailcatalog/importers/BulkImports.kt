package org.trailcatalog.importers

import java.sql.Connection

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