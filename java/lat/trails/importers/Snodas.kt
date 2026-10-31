package lat.trails.importers

import com.fasterxml.jackson.databind.ObjectMapper
import java.awt.image.BufferedImage
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.file.Path
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Locale
import javax.imageio.ImageIO
import kotlin.math.PI
import kotlin.math.atan
import kotlin.math.floor
import kotlin.math.sinh
import org.slf4j.LoggerFactory
import org.trailcatalog.flags.FlagSpec
import org.trailcatalog.flags.createFlag
import org.trailcatalog.flags.parseFlags
import org.trailcatalog.importers.elevation.contour.MbtilesWriter

private val logger = LoggerFactory.getLogger("Snodas")

// The day to tile, defaulting to today in UTC. NSIDC publishes each day at 13:00 UTC, or 14:00 while
// the US is on standard time.
@FlagSpec(name = "date")
private val date = createFlag("")

@FlagSpec(name = "output")
private val output = createFlag(Path.of("snodas.mbtiles"))

// https://nsidc.org/data/g02158
private const val ARCHIVE_URL = "https://noaadata.apps.nsidc.org/NOAA/G02158/masked"

// Product codes from the SNODAS user guide. They appear in the file names inside each archive.
private const val DEPTH_PRODUCT = "1036"
private const val WATER_PRODUCT = "1034"

// SNODAS cells are 30 arc-seconds, about 930 m. A z7 pixel is 920 m at 40 degrees north, so z8
// tiles would have no more detail than z7. Clients scale up z7 tiles past zoom 7.
private const val MAX_ZOOM = 7
private const val TILE_SIZE = 256

// Each pixel's 24 RGB bits hold snow depth in cm in the high 12 bits and snow water equivalent in
// mm in the low 12 bits. See weather.ts#unpackChannel.
private val DEPTH_CM = Channel("depth", 12, 1.0, 0.0)
private val WATER_MM = Channel("water", 12, 1.0, 0.0)

private class Grid(
    val columns: Int,
    val rows: Int,
    val west: Double,
    val north: Double,
    val cellDegrees: Double,
    // in mm, negative where there is no data
    val values: ShortArray,
) {

  val east = west + columns * cellDegrees
  val south = north - rows * cellDegrees

  fun at(lat: Double, lng: Double): Int {
    val column = floor((lng - west) / cellDegrees).toInt()
    val row = floor((north - lat) / cellDegrees).toInt()
    if (column < 0 || column >= columns || row < 0 || row >= rows) {
      return -1
    }
    return values[row * columns + column].toInt()
  }
}

fun main(args: Array<String>) {
  parseFlags(args)

  val day = if (date.value.isEmpty()) LocalDate.now(ZoneOffset.UTC) else LocalDate.parse(date.value)
  val month = day.month.getDisplayName(TextStyle.SHORT, Locale.US)
  val url =
      "${ARCHIVE_URL}/${day.year}/${"%02d".format(day.monthValue)}_${month}" +
          "/SNODAS_${day.format(DateTimeFormatter.BASIC_ISO_DATE)}.tar"
  logger.info("Fetching {}", url)
  // Most hourly runs come before NSIDC posts the day, and snodas.sh takes the missing output to
  // mean there is nothing to convert.
  val tar = fetchBytesIfFound(url)
  if (tar == null) {
    logger.info("{} isn't posted yet", day)
    return
  }
  val files = readTar(tar)
  val depth = readGrid(files, DEPTH_PRODUCT)
  val water = readGrid(files, WATER_PRODUCT)
  check(depth.columns == water.columns && depth.rows == water.rows) { "Grids differ" }

  MbtilesWriter(output.value).use { mbtiles ->
    mbtiles.setMetadata("name", "SNODAS ${day}")
    // pmtiles convert merges the json row into the archive's metadata
    val channels = listOf(DEPTH_CM, WATER_MM).map(Channel::toMap)
    mbtiles.setMetadata("json", ObjectMapper().writeValueAsString(mapOf("channels" to channels)))
    // PNG because the pixels are data, and lossy compression would corrupt them.
    // TODO(april): write lossless WebP instead, which is 30% smaller. The encoder has natives for
    // every platform we build on, but layer_catalog.ts#snodasUrl expects PNG.
    mbtiles.setMetadata("format", "png")
    mbtiles.setMetadata("minzoom", "0")
    mbtiles.setMetadata("maxzoom", MAX_ZOOM.toString())
    mbtiles.setMetadata("bounds", "${depth.west},${depth.south},${depth.east},${depth.north}")

    var count = 0
    for (z in 0..MAX_ZOOM) {
      // We write tiles with no snow too, so clients get an empty tile instead of a 404. pmtiles
      // stores identical tiles once, so they cost almost nothing.
      for (x in tileX(depth.west, z)..tileX(depth.east, z)) {
        for (y in tileY(depth.north, z)..tileY(depth.south, z)) {
          val image = BufferedImage(TILE_SIZE, TILE_SIZE, BufferedImage.TYPE_INT_RGB)
          for (py in 0 until TILE_SIZE) {
            val lat = tileLat(y + (py + 0.5) / TILE_SIZE, z)
            for (px in 0 until TILE_SIZE) {
              val lng = (x + (px + 0.5) / TILE_SIZE) / (1 shl z) * 360 - 180
              image.setRGB(px, py, pack(depth.at(lat, lng), water.at(lat, lng)))
            }
          }

          val bytes = ByteArrayOutputStream()
          ImageIO.write(image, "png", bytes)
          mbtiles.insertTile(x, y, z, bytes.toByteArray())
          count += 1
        }
      }
    }
    logger.info("Wrote {} tiles to {}", count, output.value)
  }
}

// Both in mm, negative where SNODAS has no data
private fun pack(depthMm: Int, waterMm: Int): Int {
  val depthCm = if (depthMm < 0) Double.NaN else depthMm / 10.0
  val water = if (waterMm < 0) Double.NaN else waterMm.toDouble()
  return (DEPTH_CM.pack(depthCm) shl WATER_MM.bits) or WATER_MM.pack(water)
}

private fun tileX(lng: Double, z: Int): Int = floor((lng + 180) / 360 * (1 shl z)).toInt()

private fun tileY(lat: Double, z: Int): Int {
  val radians = Math.toRadians(lat)
  val mercator = Math.log(Math.tan(radians) + 1 / Math.cos(radians))
  return floor((1 - mercator / PI) / 2 * (1 shl z)).toInt()
}

// y is in tiles and can be fractional
private fun tileLat(y: Double, z: Int): Double =
    Math.toDegrees(atan(sinh(PI * (1 - 2 * y / (1 shl z)))))

private fun readGrid(files: Map<String, ByteArray>, product: String): Grid {
  // File names look like us_ssmv11036tS__T0001TTNATS2026021505HP001.dat.gz. The product code
  // follows a 0 or 1.
  val prefix = Regex("^us_ssmv[01]${product}")
  fun find(suffix: String) =
      files.entries.single { prefix.containsMatchIn(it.key) && it.key.endsWith(suffix) }.value

  val header = HashMap<String, String>()
  for (line in gunzip(find(".txt.gz")).toString(Charsets.US_ASCII).lines()) {
    val split = line.indexOf(':')
    if (split > 0) {
      header[line.substring(0, split).trim()] = line.substring(split + 1).trim()
    }
  }
  check(header["Data units"] == "Meters / 1000.000000") {
    "Unexpected units ${header["Data units"]} for ${product}"
  }

  val columns = header["Number of columns"]!!.toInt()
  val rows = header["Number of rows"]!!.toInt()
  val west = header["Minimum x-axis coordinate"]!!.toDouble()
  val east = header["Maximum x-axis coordinate"]!!.toDouble()
  val north = header["Maximum y-axis coordinate"]!!.toDouble()
  val values = ShortArray(columns * rows)
  ByteBuffer.wrap(gunzip(find(".dat.gz"))).order(ByteOrder.BIG_ENDIAN).asShortBuffer().get(values)
  return Grid(columns, rows, west, north, (east - west) / columns, values)
}
