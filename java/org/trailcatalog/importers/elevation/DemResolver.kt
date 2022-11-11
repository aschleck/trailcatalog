package org.trailcatalog.importers.elevation

import com.google.common.cache.CacheBuilder
import com.google.common.cache.CacheLoader
import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2LatLngRect
import com.zaxxer.hikari.HikariDataSource
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.slf4j.LoggerFactory
import org.trailcatalog.importers.common.download
import org.trailcatalog.importers.elevation.tiff.GeoTiffReader
import org.trailcatalog.s2.earthMetersToAngle
import java.nio.file.Path

private val logger = LoggerFactory.getLogger(DemResolver::class.java)

class DemResolver(private val hikari: HikariDataSource) {

  private var area = S2LatLngRect.empty()
  private val metadata = ArrayList<DemMetadata>()

  private val dems =
      CacheBuilder.newBuilder().maximumSize(30).build(
          object : CacheLoader<DemMetadata, GeoTiffReader>() {
            override fun load(p0: DemMetadata): GeoTiffReader {
              val url = p0.url.toHttpUrl()
              val path = Path.of("dems", url.pathSegments[url.pathSegments.size - 1])
              download(url, path)
              logger.info("Opening DEM {}", p0)
              return GeoTiffReader(path, )
            }
          })

  fun query(ll: S2LatLng): Float {
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
    throw IllegalStateException("Unable to find a DEM for ${ll}")
  }
}