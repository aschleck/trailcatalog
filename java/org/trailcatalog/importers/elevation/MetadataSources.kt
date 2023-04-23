package org.trailcatalog.importers.elevation

import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2LatLngRect
import com.zaxxer.hikari.HikariDataSource
import org.postgresql.util.PGobject
import org.trailcatalog.importers.common.ClosedIntRange
import org.trailcatalog.importers.common.toClosedIntRange
import kotlin.math.abs

fun getDemMetadata(area: S2LatLngRect, hikari: HikariDataSource): List<DemMetadata> {
  return /*getTargetedMetadata(area, hikari) +*/ getCopernicus30m(area)
}

private fun getCopernicus30m(area: S2LatLngRect): List<DemMetadata> {
  val metadata = ArrayList<DemMetadata>()
  for (lat in Math.floor(area.lo().latDegrees()).toInt() .. Math.ceil(area.hi().latDegrees()).toInt()) {
    for (lng in Math.floor(area.lo().lngDegrees()).toInt() .. Math.ceil(area.hi().lngDegrees()).toInt()) {
      metadata.add(
          DemMetadata(
              "copernicus/${lat}/${lng}",
              S2LatLngRect.fromPointPair(
                  S2LatLng.fromDegrees(lat.toDouble(), lng.toDouble()),
                  S2LatLng.fromDegrees(lat + 1.0, lng + 1.0),
              ),
              getCopernicus30mUrl(lat, lng),
              global = true,
          ))
    }
  }
  return metadata
}

fun getCopernicus30mUrl(lat: Int, lng: Int): String {
  val pLat = abs(lat).toString().padStart(2, '0')
  val pLng = abs(lng).toString().padStart(3, '0')
  val fLat = (if (lat < 0) "S" else "N") + pLat
  val fLng = (if (lng < 0) "W" else "E") + pLng
  return ("https://copernicus-dem-30m.s3.amazonaws.com/"
              + "Copernicus_DSM_COG_10_${fLat}_00_${fLng}_00_DEM/"
              + "Copernicus_DSM_COG_10_${fLat}_00_${fLng}_00_DEM.tif")
}

private fun getTargetedMetadata(area: S2LatLngRect, hikari: HikariDataSource): List<DemMetadata> {
  return hikari.connection.use { connection ->
    connection.prepareStatement(
        "SELECT namespace, id, lat_bound_degrees, lng_bound_degrees, url " +
            "FROM digital_elevation_models " +
            "WHERE " +
            "lat_bound_degrees && ? " +
            "AND " +
            "lng_bound_degrees && ? " +
            "ORDER BY resolution_radians ASC, date DESC").also {
      it.setObject(1, ClosedIntRange(area.latLo().e7(), area.latHi().e7()))
      it.setObject(2, ClosedIntRange(area.lngLo().e7(), area.lngHi().e7()))
    }.executeQuery().use {
      val metadata = ArrayList<DemMetadata>()
      while (it.next()) {
        val namespace = it.getString(1)
        val id = it.getString(2)
        val latBound = it.getObject(3, PGobject::class.java).toClosedIntRange()
        val lngBound = it.getObject(4, PGobject::class.java).toClosedIntRange()
        val bound = S2LatLngRect.fromPointPair(
            S2LatLng.fromE7(latBound.low, lngBound.low),
            S2LatLng.fromE7(latBound.high, lngBound.high))
        val url = it.getString(5)
        metadata.add(DemMetadata("${namespace}/${id}", bound, url, global = false))
      }
      metadata
    }
  }
}