package org.trailcatalog.importers.elevation

import com.google.common.cache.CacheBuilder
import com.google.common.cache.CacheLoader
import com.google.common.geometry.S2LatLng
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.trailcatalog.importers.common.NotFoundException
import org.trailcatalog.importers.common.download
import org.trailcatalog.importers.elevation.tiff.ConstantReader
import org.trailcatalog.importers.elevation.tiff.DemReader
import org.trailcatalog.importers.elevation.tiff.GeoTiffReader
import java.net.URI
import java.nio.file.Path
import kotlin.math.abs
import kotlin.math.floor

// Closing a GeoTiffReader deletes the tiff it read, so an eviction costs a 40 MB download to get it
// back. A tile is one degree, around 111 km, and ways arrive grouped into level 7 cells of about
// 100 km, so a handful of tiles serves a group and 30 leaves room for the neighbors.
private const val TILE_CACHE_SIZE = 30L

/** Samples elevations out of the Copernicus 30m DSM, downloading tiffs as it goes. */
class CopernicusResolver(private val root: Path) : DemResolver {

  private val tiles =
      CacheBuilder.newBuilder()
          .maximumSize(TILE_CACHE_SIZE)
          .removalListener<Corner, DemReader> {
            it.value?.close()
          }
          .build(
              object : CacheLoader<Corner, DemReader>() {
                override fun load(p0: Corner) = read(p0)
              })

  override fun close() {
    tiles.invalidateAll()
  }

  override fun query(ll: S2LatLng): Float? {
    val corner =
        Corner(
            floor(ll.latDegrees()).toInt(),
            floor(ll.lngDegrees()).toInt())
    return tiles[corner].query(ll)
  }

  private fun read(corner: Corner): DemReader {
    val url = copernicus30mUrl(corner.lat, corner.lng)
    val path = root.resolve(Path.of(URI(url).path).fileName)
    return try {
      download(url.toHttpUrl(), path)
      GeoTiffReader(path)
    } catch (e: NotFoundException) {
      // Copernicus publishes a tile only where there is land in it, so the rest is ocean.
      ConstantReader(0f)
    }
  }
}

private data class Corner(val lat: Int, val lng: Int)

/** Returns the URL of the one degree tile whose southwest corner is at [lat], [lng]. */
fun copernicus30mUrl(lat: Int, lng: Int): String {
  val pLat = abs(lat).toString().padStart(2, '0')
  val pLng = abs(lng).toString().padStart(3, '0')
  val fLat = (if (lat < 0) "S" else "N") + pLat
  val fLng = (if (lng < 0) "W" else "E") + pLng
  return ("https://copernicus-dem-30m.s3.amazonaws.com/"
              + "Copernicus_DSM_COG_10_${fLat}_00_${fLng}_00_DEM/"
              + "Copernicus_DSM_COG_10_${fLat}_00_${fLng}_00_DEM.tif")
}
