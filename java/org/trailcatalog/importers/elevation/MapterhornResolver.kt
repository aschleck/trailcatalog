package org.trailcatalog.importers.elevation

import com.google.common.cache.CacheBuilder
import com.google.common.cache.CacheLoader
import com.google.common.geometry.S2LatLng
import org.trailcatalog.common.IORuntimeException
import org.trailcatalog.importers.elevation.pmtiles.COMPRESSION_NONE
import org.trailcatalog.importers.elevation.pmtiles.PmtilesReader
import org.trailcatalog.importers.elevation.pmtiles.TILE_TYPE_PNG
import org.trailcatalog.importers.elevation.pmtiles.TILE_TYPE_WEBP
import java.io.ByteArrayInputStream
import java.nio.file.Path
import javax.imageio.ImageIO
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.sin

// Mapterhorn publishes a planet DEM as terrarium encoded WebP tiles in a PMTiles archive, 512
// pixels to a tile from z0 to z12.
// https://github.com/mapterhorn/mapterhorn
private const val TILE_SIZE = 512

// Terrarium packs meters as r * 256 + g + b / 256 - 32768, so a pixel resolves to 1/256 of a meter.
private const val TERRARIUM_OFFSET = 32768f

// Ways arrive grouped into level 7 cells, which are around 100 km on a side. A z12 tile is 9.8 km
// wide at the equator and cos(latitude) of that further north, so a cell spans 100 tiles there and
// a few hundred at temperate latitudes. Each tile decodes to a megabyte of floats.
private const val TILE_CACHE_SIZE = 256L

/** Samples elevations out of a mapterhorn PMTiles archive. Queries are thread safe. */
class MapterhornResolver(path: Path) : DemResolver {

  private val archive = PmtilesReader(path)
  private val zoom = archive.maxZoom
  private val worldPixels = TILE_SIZE.toLong() shl zoom

  private val tiles =
      CacheBuilder.newBuilder()
          .maximumSize(TILE_CACHE_SIZE)
          .build(
              object : CacheLoader<TileAddress, Tile>() {
                override fun load(p0: TileAddress) = decode(p0)
              })

  init {
    // We should expect lossless formats because otherwise the tiles would have huge errors
    if (archive.tileType != TILE_TYPE_WEBP && archive.tileType != TILE_TYPE_PNG) {
      throw IllegalArgumentException(
          "${path} holds tile type ${archive.tileType}, which is neither WebP nor PNG")
    }
    if (archive.tileCompression != COMPRESSION_NONE) {
      throw IllegalArgumentException(
          "${path} compresses tiles with ${archive.tileCompression}, which we don't support")
    }
  }

  override fun close() {
    archive.close()
  }

  override fun query(ll: S2LatLng): Float? {
    // Samples sit at pixel centers, so shifting by half a pixel gives the four pixels the point
    // falls between.
    val x = projectX(ll) - 0.5
    val y = projectY(ll) - 0.5
    val lx = floor(x).toLong()
    val ly = floor(y).toLong()
    val fx = (x - lx).toFloat()
    val fy = (y - ly).toFloat()

    // Ocean is absent from the archive rather than stored as zeros, so a point with no pixel has
    // no elevation to report. Neighbors go missing along coasts, where the nearest sample is
    // close enough.
    val tl = query(lx, ly) ?: return null
    val tr = query(lx + 1, ly) ?: tl
    val bl = query(lx, ly + 1) ?: tl
    val br = query(lx + 1, ly + 1) ?: tr
    return mix(fy, mix(fx, tl, tr), mix(fx, bl, br))
  }

  private fun query(px: Long, py: Long): Float? {
    if (py < 0 || py >= worldPixels) {
      return null
    }

    val x = Math.floorMod(px, worldPixels)
    val heights =
        tiles[TileAddress((x / TILE_SIZE).toInt(), (py / TILE_SIZE).toInt())].heights ?: return null
    return heights[((py % TILE_SIZE) * TILE_SIZE + x % TILE_SIZE).toInt()]
  }

  private fun decode(address: TileAddress): Tile {
    val bytes = archive.query(zoom, address.x, address.y) ?: return Tile(null)
    val image =
        ImageIO.read(ByteArrayInputStream(bytes))
            ?: throw IORuntimeException("No decoder for tile ${zoom}/${address.x}/${address.y}")
    if (image.width != TILE_SIZE || image.height != TILE_SIZE) {
      throw IORuntimeException(
          "Tile ${zoom}/${address.x}/${address.y} is ${image.width}x${image.height}")
    }

    val pixels = image.getRGB(0, 0, TILE_SIZE, TILE_SIZE, null, 0, TILE_SIZE)
    val heights = FloatArray(pixels.size)
    for (i in pixels.indices) {
      val r = (pixels[i] shr 16) and 0xff
      val g = (pixels[i] shr 8) and 0xff
      val b = pixels[i] and 0xff
      heights[i] = r * 256f + g + b / 256f - TERRARIUM_OFFSET
    }
    return Tile(heights)
  }

  private fun projectX(ll: S2LatLng): Double {
    return (ll.lngDegrees() + 180) / 360 * worldPixels
  }

  private fun projectY(ll: S2LatLng): Double {
    val sin = sin(ll.latRadians())
    return (0.5 - ln((1 + sin) / (1 - sin)) / (4 * Math.PI)) * worldPixels
  }
}

private data class TileAddress(val x: Int, val y: Int)

// Guava caches can't hold nulls, and the ocean tiles we ask for don't exist.
private class Tile(val heights: FloatArray?)

private fun mix(f: Float, a: Float, b: Float): Float {
  return (1 - f) * a + f * b
}
