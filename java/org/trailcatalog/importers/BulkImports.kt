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
  chunks: Int = 1000,
  fn: (PrimitiveBlock) -> Unit) {
  FileInputStream(pbf).use {
    ProgressBar(action, "blocks").use { progress ->
      val blocks = PbfBlockReader(it).readBlocks().iterator()
      while (blocks.hasNext()) {
        var i = 0
        withTempTables(tables, connection) {
          while (i < chunks && blocks.hasNext()) {
            fn.invoke(blocks.next())
            i += 1
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
