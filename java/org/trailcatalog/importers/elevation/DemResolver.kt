package org.trailcatalog.importers.elevation

import com.google.common.cache.CacheBuilder
import com.google.common.cache.CacheLoader
import com.google.common.collect.MapMaker
import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2LatLngRect
import com.zaxxer.hikari.HikariDataSource
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.postgresql.util.PGobject
import org.slf4j.LoggerFactory
import org.trailcatalog.importers.common.ClosedIntRange
import org.trailcatalog.importers.common.download
import org.trailcatalog.importers.common.toClosedIntRange
import org.trailcatalog.s2.earthMetersToAngle
import java.nio.file.Path

private val logger = LoggerFactory.getLogger(DemResolver::class.java)

private data class DemMetadata(val id: String, val bounds: S2LatLngRect, val url: String)

class DemResolver(private val hikari: HikariDataSource) {

  private var area = S2LatLngRect.empty()
  private val metadata = ArrayList<DemMetadata>()

  private val dems =
      CacheBuilder.newBuilder().maximumSize(3).build(
          object : CacheLoader<DemMetadata, ProjectedDem>() {
            override fun load(p0: DemMetadata): ProjectedDem {
              val url = p0.url.toHttpUrl()
              val path = Path.of("dems", url.pathSegments[url.pathSegments.size - 1])
              download(url, path)
              logger.info("Opening DEM {}", p0)
              return ProjectedDem(path.toFile())
            }
          })

  fun query(ll: S2LatLng): Float {
    if (!area.contains(ll)) {
      area = S2LatLngRect.fromPoint(ll).expandedByDistance(earthMetersToAngle(16093.0))
      metadata.clear()
      hikari.connection.use { connection ->
        connection.prepareStatement(
            "SELECT id, lat_bound_degrees, lng_bound_degrees, url " +
            "FROM usgs_elevation_models " +
            "WHERE " +
            "lat_bound_degrees && ? " +
            "AND " +
            "lng_bound_degrees && ? " +
            "AND " +
            "resolution_radians > 1.5696098420815538e-07" +
            "ORDER BY resolution_radians ASC, date DESC").also {
          it.setObject(1, ClosedIntRange(area.latLo().e7(), area.latHi().e7()))
          it.setObject(2, ClosedIntRange(area.lngLo().e7(), area.lngHi().e7()))
        }.executeQuery().use {
          while (it.next()) {
            val id = it.getString(1)
            val latBound = it.getObject(2, PGobject::class.java).toClosedIntRange()
            val lngBound = it.getObject(3, PGobject::class.java).toClosedIntRange()
            val bound = S2LatLngRect.fromPointPair(
                S2LatLng.fromE7(latBound.low, lngBound.low),
                S2LatLng.fromE7(latBound.high, lngBound.high))
            val url = it.getString(4)
            metadata.add(DemMetadata(id, bound, url))
          }
        }
      }
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