package org.trailcatalog.importers.elevation.contour

import java.io.Closeable
import java.nio.file.Path
import java.sql.DriverManager
import java.sql.PreparedStatement

class MbtilesWriter(path: Path) : Closeable {
  // Doesn't produce valid mbtiles files, but they're good enough to convert to pmtiles!

  private val connection = DriverManager.getConnection("jdbc:sqlite:${path}")
  private val insertStatement: PreparedStatement

  init {
    connection.createStatement().use {
      it.executeUpdate("PRAGMA synchronous=0")
      it.executeUpdate("PRAGMA locking_mode=EXCLUSIVE")
      it.executeUpdate("PRAGMA journal_mode=DELETE")

      it.executeUpdate("""
          CREATE TABLE tiles (
              zoom_level INTEGER,
              tile_column INTEGER,
              tile_row INTEGER,
              tile_data blob)
      """)
      it.executeUpdate("CREATE TABLE metadata (name TEXT, value TEXT)")
      it.executeUpdate("CREATE UNIQUE INDEX name on metadata (name)")
      it.executeUpdate("CREATE UNIQUE INDEX tile_index on tiles (zoom_level, tile_column, tile_row)")
    }

    insertStatement =
        connection.prepareStatement(
            "INSERT INTO tiles (zoom_level, tile_row, tile_column, tile_data) VALUES (?, ?, ?, ?)")
  }

  override fun close() {
    insertStatement.close()
    connection.close()
  }

  fun insertTile(x: Int, y: Int, z: Int, data: ByteArray) {
    synchronized (insertStatement) {
      insertStatement.setInt(1, z)
      insertStatement.setInt(2, (1 shl z) - 1 - y)
      insertStatement.setInt(3, x)
      insertStatement.setBytes(4, data)
      insertStatement.executeUpdate()
    }
  }
}