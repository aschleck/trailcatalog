package org.trailcatalog.importers.elevation

import com.google.common.geometry.S2LatLng
import com.google.common.truth.Truth.assertThat
import org.junit.Test
import org.trailcatalog.importers.elevation.pmtiles.TILE_TYPE_PNG
import java.awt.image.BufferedImage
import java.io.ByteArrayOutputStream
import javax.imageio.ImageIO
import kotlin.io.path.createTempDirectory
import kotlin.math.PI
import kotlin.math.atan
import kotlin.math.roundToInt
import kotlin.math.sinh

private const val TILE_SIZE = 512

class MapterhornResolverTest {

  @Test
  fun testQueryReadsThePixelUnderThePoint() {
    resolverOf(maxZoom = 1).use {
      // Row 0 sits half a pixel below the top of the world, which is 85 degrees north, so its
      // center rounds off the map.
      for ((x, y) in listOf(0 to 1, 10 to 20, 511 to 511)) {
        assertThat(it.query(pixelCenter(x, y, worldPixels = 2 * TILE_SIZE)))
            .isWithin(0.01f)
            .of(heightAt(x, y))
      }
    }
  }

  @Test
  fun testQueryReadsFractionalMeters() {
    resolverOf(maxZoom = 1) { x, y -> if (x == 3 && y == 4) 12.5f else 0f }.use {
      assertThat(it.query(pixelCenter(3, 4, worldPixels = 2 * TILE_SIZE)))
          .isWithin(0.001f)
          .of(12.5f)
    }
  }

  @Test
  fun testQueryInterpolatesBetweenPixels() {
    resolverOf(maxZoom = 1).use {
      val between =
          S2LatLng.fromDegrees(
              pixelCenter(10, 20, worldPixels = 2 * TILE_SIZE).latDegrees(),
              lngOfPixel(10 + 1.0, worldPixels = 2 * TILE_SIZE))
      assertThat(it.query(between))
          .isWithin(0.01f)
          .of((heightAt(10, 20) + heightAt(11, 20)) / 2)
    }
  }

  // A tile's pixels stop at the edge of the tile, so the pixel west of longitude -180 is the last
  // pixel of the easternmost tile.
  @Test
  fun testQueryWrapsAroundTheAntimeridian() {
    resolverOf(maxZoom = 1).use {
      val west = it.query(S2LatLng.fromDegrees(0.0, -180.0))
      val east = it.query(S2LatLng.fromDegrees(0.0, 180.0))
      assertThat(west).isEqualTo(east)
      assertThat(west).isWithin(0.01f).of((heightAt(511, 511) + heightAt(0, 511)) / 2)
    }
  }

  @Test
  fun testQueryReturnsNullWhereTheArchiveHasNoTile() {
    // The archive holds the northern hemisphere only, so anywhere south of the equator is ocean as
    // far as it is concerned.
    resolverOf(maxZoom = 1).use {
      assertThat(it.query(S2LatLng.fromDegrees(-45.0, 0.0))).isNull()
    }
  }

  @Test
  fun testQueryReturnsNullBeyondTheMercatorLimit() {
    resolverOf(maxZoom = 1).use {
      assertThat(it.query(S2LatLng.fromDegrees(90.0, 0.0))).isNull()
    }
  }

  @Test
  fun testQueryPrefersARegionalArchive() {
    resolverOf(maxZoom = 1, regional = true).use {
      assertThat(it.query(pixelCenter(100, 100, worldPixels = 2 * TILE_SIZE))).isEqualTo(1000f)
    }
  }

  @Test
  fun testQueryFallsBackToThePlanetInAHoleInARegion() {
    resolverOf(maxZoom = 1, regional = true).use {
      assertThat(it.query(pixelCenter(384, 384, worldPixels = 2 * TILE_SIZE)))
          .isWithin(0.01f)
          .of(heightAt(384, 384))
    }
  }

  @Test
  fun testQueryFallsBackToThePlanetOutsideAnyRegion() {
    resolverOf(maxZoom = 1, regional = true).use {
      // Every planet tile is the same image, so world pixel 700 is pixel 188 of its tile.
      assertThat(it.query(pixelCenter(700, 100, worldPixels = 2 * TILE_SIZE)))
          .isWithin(0.01f)
          .of(heightAt(700 - TILE_SIZE, 100))
    }
  }

  // Mapterhorn ships WebP, but the WebP plugin only carries x86 natives and PNG is lossless all the
  // same, so the tiles here are PNG.
  private fun resolverOf(
      maxZoom: Int,
      regional: Boolean = false,
      heights: (x: Int, y: Int) -> Float = ::heightAt): MapterhornResolver {
    val directory = createTempDirectory()
    val tile = terrariumTile(heights)
    val planet = Archive(maxZoom = maxZoom, tileType = TILE_TYPE_PNG)
    val tiles = 1 shl maxZoom
    // The southern half stays empty so that missing tiles get exercised.
    for (x in 0 until tiles) {
      planet.put(maxZoom, x, 0, tile)
    }
    planet.write(directory.resolve("planet.pmtiles"))

    // One zoom finer over the northwestern tile, with its southeastern quarter left as a hole
    if (regional) {
      val z = maxZoom + 1
      val flat = terrariumTile { _, _ -> 1000f }
      Archive(minZoom = z, maxZoom = z, tileType = TILE_TYPE_PNG)
          .put(z, 0, 0, flat)
          .put(z, 1, 0, flat)
          .put(z, 0, 1, flat)
          .write(directory.resolve("${maxZoom}-0-0.pmtiles"))
    }
    return MapterhornResolver(directory)
  }
}

// Distinct enough per pixel that reading a neighbor by mistake shows up, and small enough to encode
// exactly.
private fun heightAt(x: Int, y: Int): Float {
  return (x * 10 + y).toFloat()
}

private fun terrariumTile(heights: (x: Int, y: Int) -> Float): ByteArray {
  val image = BufferedImage(TILE_SIZE, TILE_SIZE, BufferedImage.TYPE_INT_RGB)
  for (y in 0 until TILE_SIZE) {
    for (x in 0 until TILE_SIZE) {
      val packed = ((heights(x, y) + 32768) * 256).roundToInt()
      image.setRGB(x, y, packed)
    }
  }

  val out = ByteArrayOutputStream()
  ImageIO.write(image, "png", out)
  return out.toByteArray()
}

private fun pixelCenter(x: Int, y: Int, worldPixels: Int): S2LatLng {
  return S2LatLng.fromDegrees(latOfPixel(y + 0.5, worldPixels), lngOfPixel(x + 0.5, worldPixels))
}

private fun latOfPixel(y: Double, worldPixels: Int): Double {
  return Math.toDegrees(atan(sinh(PI * (1 - 2 * y / worldPixels))))
}

private fun lngOfPixel(x: Double, worldPixels: Int): Double {
  return x / worldPixels * 360 - 180
}
