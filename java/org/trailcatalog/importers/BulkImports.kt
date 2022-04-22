package org.trailcatalog.importers

import crosby.binary.Osmformat.PrimitiveBlock
import org.trailcatalog.pbf.PbfBlockReader
import java.io.FileInputStream
import java.sql.Connection

fun blockedOperation(
  action: String,
  pbf: String,
  tables: List<String>,
  connection: Connection,
  fn: (PrimitiveBlock) -> Unit) {
  FileInputStream(pbf).use {
    val reader = PbfBlockReader(it)

    ProgressBar(action, "blocks").use { progress ->
      for (blocks in reader.readBlocks().chunked(1000)) {
        withTempTables(tables, connection) {
          for (block in blocks) {
            fn.invoke(block)
            progress.increment()
          }
        }
      }
    }
  }
}

fun withTempTables(wrapping: List<String>, connection: Connection, fn: () -> Unit) {
  for (table in wrapping) {
    connection.createStatement().execute(
        "CREATE TEMP TABLE IF NOT EXISTS tmp_${table} (LIKE ${table} INCLUDING DEFAULTS) " +
            "ON COMMIT DELETE ROWS")
  }

  fn.invoke()

  for (table in wrapping) {
    connection.createStatement().execute(
        "INSERT INTO ${table} SELECT * FROM tmp_${table} ON CONFLICT DO NOTHING")
  }

  connection.commit()
}
