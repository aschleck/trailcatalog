package org.trailcatalog.importers.basemap

import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pipeline.PSource
import org.trailcatalog.importers.pipeline.collections.getSerializer
import org.trailcatalog.importers.pipeline.io.EncodedInputStream
import java.io.RandomAccessFile
import java.nio.channels.FileChannel.MapMode

class ElevationProfilesReader(private val optional: Boolean = false) : PSource<Profile>() {

  private val serializer = getSerializer(TypeToken.of(Profile::class.java))

  override fun read() = sequence {
    if (!optional || ELEVATION_PROFILES_FILE.exists()) {
      RandomAccessFile(ELEVATION_PROFILES_FILE, "r").use {
        val map = it.channel.map(MapMode.READ_ONLY, 0, ELEVATION_PROFILES_FILE.length())
        EncodedInputStream(map).use { input ->
          while (input.hasRemaining()) {
            yield(serializer.read(input))
          }
        }
      }
    }
  }
}
