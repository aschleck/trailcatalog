package org.trailcatalog.importers.elevation

import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2LatLngRect
import kotlin.math.abs

fun getDemMetadata(area: S2LatLngRect): List<DemMetadata> {
  return getCopernicus30m(area)
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
