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
import kotlin.io.path.listDirectoryEntries
import kotlin.io.path.name
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.sin

// Mapterhorn publishes a planet DEM as terrarium encoded WebP tiles in a PMTiles archive, 512
// pixels to a tile from z0 to z12, and finer zooms where a finer source exists as one archive per
// z6 tile named like 6-10-24.pmtiles.
// https://mapterhorn.com/data-access/
private const val TILE_SIZE = 512
private const val PLANET_ARCHIVE = "planet.pmtiles"
private val REGIONAL_ARCHIVE = Regex("""(\d+)-(\d+)-(\d+)\.pmtiles""")

// On Four Mile Trail and Upper Yosemite Fall, z14 gives the same climb as z16 once reversals under
// CLIMB_THRESHOLD_METERS are dropped, and z13 through z14 of every regional archive is 755 GB
// against 9.6 TB for all of it.
// Keep in sync with measurements.ts#profileSamples.
private const val MAX_ZOOM = 14

// Terrarium packs meters as r * 256 + g + b / 256 - 32768, so a pixel resolves to 1/256 of a meter.
private const val TERRARIUM_OFFSET = 32768f

// Ways arrive grouped into level 7 cells, which are around 100 km on a side. A z14 tile is 2.4 km
// wide at the equator and cos(latitude) of that further north, so a cell spans a few thousand
// tiles where we have z14, though trails only cross some of them. Each tile decodes to a megabyte
// of floats.
private const val TILE_CACHE_SIZE = 1024L

/**
 * Samples elevations out of a directory of mapterhorn PMTiles archives, at the finest zoom up to
 * MAX_ZOOM that covers each point. Queries are thread safe.
 */
class MapterhornResolver(directory: Path) : DemResolver {

  private val planet = PmtilesReader(directory.resolve(PLANET_ARCHIVE))
  // By the zoom and tile named in the file
  private val regions = HashMap<TileAddress, PmtilesReader>()
  private val regionZooms: List<Int>

  private val tiles =
      CacheBuilder.newBuilder()
          .maximumSize(TILE_CACHE_SIZE)
          .build(
              object : CacheLoader<TileAddress, Tile>() {
                override fun load(p0: TileAddress) = decode(p0)
              })

  init {
    checkArchive(directory.resolve(PLANET_ARCHIVE), planet)
    for (path in directory.listDirectoryEntries("*.pmtiles")) {
      val match = REGIONAL_ARCHIVE.matchEntire(path.name) ?: continue
      val (z, x, y) = match.destructured
      val archive = PmtilesReader(path)
      checkArchive(path, archive)
      regions[TileAddress(z.toInt(), x.toInt(), y.toInt())] = archive
    }
    regionZooms = regions.keys.map { it.z }.distinct()
  }

  override fun close() {
    planet.close()
    for (archive in regions.values) {
      archive.close()
    }
  }

  override fun query(ll: S2LatLng): Float? {
    val x = projectX(ll)
    val y = projectY(ll)
    if (y < 0 || y >= 1) {
      return null
    }

    // A regional archive can leave holes, so each zoom falls back to the next coarser one.
    val region = regionAt(x, y)
    if (region != null) {
      for (z in minOf(MAX_ZOOM, region.maxZoom) downTo maxOf(planet.maxZoom + 1, region.minZoom)) {
        val corners = corners(x, y, z)
        val tl = pixel(z, corners.lx, corners.ly) ?: continue
        val tr = pixel(z, corners.lx + 1, corners.ly) ?: continue
        val bl = pixel(z, corners.lx, corners.ly + 1) ?: continue
        val br = pixel(z, corners.lx + 1, corners.ly + 1) ?: continue
        return mix(corners.fy, mix(corners.fx, tl, tr), mix(corners.fx, bl, br))
      }
    }

    // Ocean is absent from the archive rather than stored as zeros, so a point with no pixel has
    // no elevation to report. Neighbors go missing along coasts, where the nearest sample is
    // close enough.
    val z = planet.maxZoom
    val corners = corners(x, y, z)
    val tl = pixel(z, corners.lx, corners.ly) ?: return null
    val tr = pixel(z, corners.lx + 1, corners.ly) ?: tl
    val bl = pixel(z, corners.lx, corners.ly + 1) ?: tl
    val br = pixel(z, corners.lx + 1, corners.ly + 1) ?: tr
    return mix(corners.fy, mix(corners.fx, tl, tr), mix(corners.fx, bl, br))
  }

  private fun regionAt(x: Double, y: Double): PmtilesReader? {
    for (z in regionZooms) {
      val tiles = 1 shl z
      val region = regions[TileAddress(z, (x * tiles).toInt(), (y * tiles).toInt())]
      if (region != null) {
        return region
      }
    }
    return null
  }

  private fun pixel(z: Int, px: Long, py: Long): Float? {
    val worldPixels = TILE_SIZE.toLong() shl z
    if (py < 0 || py >= worldPixels) {
      return null
    }

    val x = Math.floorMod(px, worldPixels)
    val heights =
        tiles[TileAddress(z, (x / TILE_SIZE).toInt(), (py / TILE_SIZE).toInt())].heights
            ?: return null
    return heights[((py % TILE_SIZE) * TILE_SIZE + x % TILE_SIZE).toInt()]
  }

  private fun archiveFor(address: TileAddress): PmtilesReader? {
    if (address.z <= planet.maxZoom) {
      return planet
    }
    for (z in regionZooms) {
      val shift = address.z - z
      val region = regions[TileAddress(z, address.x shr shift, address.y shr shift)]
      if (region != null && address.z in region.minZoom..region.maxZoom) {
        return region
      }
    }
    return null
  }

  private fun decode(address: TileAddress): Tile {
    val bytes =
        archiveFor(address)?.query(address.z, address.x, address.y) ?: return Tile(null)
    val image =
        ImageIO.read(ByteArrayInputStream(bytes))
            ?: throw IORuntimeException("No decoder for tile ${address}")
    if (image.width != TILE_SIZE || image.height != TILE_SIZE) {
      throw IORuntimeException("Tile ${address} is ${image.width}x${image.height}")
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

}

// We should expect lossless formats because otherwise the tiles would have huge errors
private fun checkArchive(path: Path, archive: PmtilesReader) {
  if (archive.tileType != TILE_TYPE_WEBP && archive.tileType != TILE_TYPE_PNG) {
    throw IllegalArgumentException(
        "${path} holds tile type ${archive.tileType}, which is neither WebP nor PNG")
  }
  if (archive.tileCompression != COMPRESSION_NONE) {
    throw IllegalArgumentException(
        "${path} compresses tiles with ${archive.tileCompression}, which we don't support")
  }
}

/** Returns the fraction of the way across the world from the antimeridian. */
private fun projectX(ll: S2LatLng): Double {
  return (ll.lngDegrees() + 180) / 360
}

/** Returns the fraction of the way down the world from the top of the mercator square. */
private fun projectY(ll: S2LatLng): Double {
  val sin = sin(ll.latRadians())
  return 0.5 - ln((1 + sin) / (1 - sin)) / (4 * Math.PI)
}

// Samples sit at pixel centers, so shifting by half a pixel gives the four pixels the point falls
// between.
private fun corners(x: Double, y: Double, z: Int): Corners {
  val worldPixels = (TILE_SIZE.toLong() shl z).toDouble()
  val px = x * worldPixels - 0.5
  val py = y * worldPixels - 0.5
  val lx = floor(px).toLong()
  val ly = floor(py).toLong()
  return Corners(lx, ly, (px - lx).toFloat(), (py - ly).toFloat())
}

private class Corners(val lx: Long, val ly: Long, val fx: Float, val fy: Float)

private data class TileAddress(val z: Int, val x: Int, val y: Int)

// Guava caches can't hold nulls, and the ocean tiles we ask for don't exist.
private class Tile(val heights: FloatArray?)

private fun mix(f: Float, a: Float, b: Float): Float {
  return (1 - f) * a + f * b
}
