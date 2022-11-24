package org.trailcatalog.importers.elevation

import com.google.common.cache.CacheBuilder
import com.google.common.cache.CacheLoader
import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2LatLngRect
import com.zaxxer.hikari.HikariDataSource
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.slf4j.LoggerFactory
import org.trailcatalog.importers.common.IORuntimeException
import org.trailcatalog.importers.common.NotFoundException
import org.trailcatalog.importers.common.download
import org.trailcatalog.importers.elevation.tiff.ConstantReader
import org.trailcatalog.importers.elevation.tiff.DemReader
import org.trailcatalog.importers.elevation.tiff.GeoTiffReader
import org.trailcatalog.s2.earthMetersToAngle
import java.nio.file.Path

private val logger = LoggerFactory.getLogger(DemResolver::class.java)

class DemResolver(private val hikari: HikariDataSource) {

  private var area = S2LatLngRect.empty()
  private val metadata = ArrayList<DemMetadata>()

  private val dems =
      CacheBuilder.newBuilder()
          .maximumSize(30)
          .removalListener<DemMetadata, DemReader> {
            it.value?.close()
          }
          .build(
              object : CacheLoader<DemMetadata, DemReader>() {
                override fun load(p0: DemMetadata): DemReader {
                  val path = demFilePath(p0)
                  logger.info("Downloading and opening DEM {}", p0)
                  try {
                    download(p0.url.toHttpUrl(), path)
                    return GeoTiffReader(path)
                  } catch (e: NotFoundException) {
                    return ConstantReader(if (p0.global) 0f else null)
                  } catch (e: IORuntimeException) {
                    logger.warn("Error fetching ${p0.url}")
                    return ConstantReader(null)
                  }
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

      val value = dems[dem].query(ll)
      if (value != null) {
        return value
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
