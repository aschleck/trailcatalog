package org.trailcatalog.importers.elevation

import com.google.common.cache.CacheBuilder
import com.google.common.cache.CacheLoader
import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2LatLngRect
import com.google.common.util.concurrent.UncheckedExecutionException
import com.zaxxer.hikari.HikariDataSource
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.slf4j.LoggerFactory
import org.trailcatalog.importers.common.NotFoundException
import org.trailcatalog.importers.common.download
import org.trailcatalog.importers.elevation.tiff.GeoTiffReader
import org.trailcatalog.s2.earthMetersToAngle
import java.nio.file.Path
import java.util.concurrent.ExecutionException

private val logger = LoggerFactory.getLogger(DemResolver::class.java)

class DemResolver(private val hikari: HikariDataSource) {

  private var area = S2LatLngRect.empty()
  private val metadata = ArrayList<DemMetadata>()

  private val dems =
      CacheBuilder.newBuilder()
          .maximumSize(30)
          .removalListener<DemMetadata, GeoTiffReader> {
            it.value?.close()
          }
          .build(
              object : CacheLoader<DemMetadata, GeoTiffReader>() {
                override fun load(p0: DemMetadata): GeoTiffReader {
                  val path = demFilePath(p0)
                  download(p0.url.toHttpUrl(), path)
                  logger.info("Opening DEM {}", p0)
                  return GeoTiffReader(path)
                }
              })

  fun query(ll: S2LatLng): Float? {
    if (!area.contains(ll)) {
      // TODO(april): this is 10 miles, but is there a reason to pull 10 miles?
      area = S2LatLngRect.fromPoint(ll).expandedByDistance(earthMetersToAngle(16093.0))
      metadata.clear()
      metadata.addAll(getDemMetadata(area, hikari))
    }

    for (dem in metadata) {
      if (!dem.bounds.contains(ll)) {
        continue
      }
      try {
        val value = dems[dem].query(ll)
        if (value != null) {
          return value
        }
      } catch (e: ExecutionException) {
        logger.warn("Failed to open DEM", e)
      } catch (e: UncheckedExecutionException) {
        if (dem.global && e.cause is NotFoundException) {
          return 0f
        } else {
          logger.warn("Failed to open DEM", e)
        }
      }
    }
    return null
  }
}

private fun demFilePath(metadata: DemMetadata): Path {
  val base = Path.of("/tmp/dems")
  base.toFile().mkdir()
  val url = metadata.url.toHttpUrl()
  return base.resolve(url.pathSegments[url.pathSegments.size - 1])
}
