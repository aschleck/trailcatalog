package lat.trails.importers

import com.luciad.imageio.webp.CompressionType
import com.luciad.imageio.webp.WebPWriteParam
import java.awt.image.BufferedImage
import java.awt.image.DataBufferInt
import java.io.ByteArrayOutputStream
import java.nio.file.Files
import java.nio.file.Path
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import javax.imageio.IIOImage
import javax.imageio.ImageIO
import javax.imageio.ImageWriteParam
import javax.imageio.stream.MemoryCacheImageOutputStream
import kotlin.math.PI
import kotlin.math.atan
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.sin
import kotlin.math.sinh
import kotlin.math.sqrt
import org.slf4j.LoggerFactory
import org.trailcatalog.flags.FlagSpec
import org.trailcatalog.flags.createFlag
import org.trailcatalog.flags.parseFlags
import org.trailcatalog.importers.elevation.contour.MbtilesWriter

private val logger = LoggerFactory.getLogger("Weather")

// The last forecast hour to tile. Runs starting at 06 and 18 UTC stop at 144.
@FlagSpec(name = "weather_max_step")
private val maxStep = createFlag(144)

@FlagSpec(name = "weather_output")
private val output = createFlag(Path.of("weather"))

// The run to tile as 2026101518, defaulting to the newest one ECMWF has finished publishing
@FlagSpec(name = "weather_run")
private val runFlag = createFlag("")

// The run we tiled last time, which we skip so an hourly timer only does work for new runs
@FlagSpec(name = "weather_previous_run")
private val previousRun = createFlag("")

// A z3 pixel is 360 / 2048 = 0.18 degrees at the equator, the first zoom finer than the 0.25
// degree grid.
private const val MAX_ZOOM = 3
private const val TILE_SIZE = 256

fun main(args: Array<String>) {
  parseFlags(args)

  val steps =
      EcmwfStream.entries.associateWith { stream ->
        val hours = WEATHER_LAYERS.filter { it.stream == stream }.minOf { it.stepHours }
        (0..maxStep.value step hours).toList()
      }
  val run =
      if (runFlag.value.isEmpty()) {
        findNewestRun(Instant.now(), steps)
      } else {
        EcmwfRun(
            LocalDateTime.parse(runFlag.value, DateTimeFormatter.ofPattern("yyyyMMddHH"))
                .toInstant(ZoneOffset.UTC))
      }
  if (run.id == previousRun.value) {
    logger.info("Run {} is already tiled", run.id)
    return
  }
  logger.info("Tiling run {}", run.id)

  Files.createDirectories(output.value)
  val pixels = tilePixels()
  val static = run.read(EcmwfStream.IFS, 0, STATIC_IFS_INPUTS)
  val lookaheadInputs = LOOKAHEAD_LAYERS.map { it.input }.toSet()
  val history = lookaheadInputs.associateWith { HashMap<Int, List<FloatArray>>() }
  val lookaheadKeys = lookaheadInputs.flatMap { it.inputs }.toSet()
  val due = { stream: EcmwfStream, step: Int ->
    WEATHER_LAYERS.filter { it.stream == stream && step % it.stepHours == 0 }
  }
  val reads = steps.flatMap { (stream, streamSteps) -> streamSteps.map { stream to it } }
  val fetcher = Executors.newSingleThreadExecutor { Thread(it).apply { isDaemon = true } }
  val fetch = { index: Int ->
    val (stream, step) = reads[index]
    val lookahead = if (stream == EcmwfStream.IFS) lookaheadKeys else setOf()
    val wanted = due(stream, step).flatMap { it.inputs }.toSet() + lookahead - STATIC_IFS_INPUTS
    fetcher.submit(Callable { run.read(stream, step, wanted) })
  }
  var next = fetch(0)
  for ((index, read) in reads.withIndex()) {
    val (stream, step) = read
    val ifs = stream == EcmwfStream.IFS
    val fields = next.get() + if (ifs) static else mapOf()
    if (index + 1 < reads.size) {
      next = fetch(index + 1)
    }
    if (ifs) {
      for ((input, steps) in history) {
        if (fields.keys.containsAll(input.inputs)) {
          steps[step] = input.compute(Inputs(fields))
        }
      }
    }
    for (layer in due(stream, step)) {
      val missing = layer.inputs - fields.keys
      if (missing.isNotEmpty()) {
        // Losing one layer at one step is better than losing the run.
        logger.warn("Skipping {} at step {} without {}", layer.name, step, missing)
        continue
      }
      val path = output.value.resolve("${layer.name}_${step}.mbtiles")
      writeLayer(layer.name, layer.channels, layer.compute(Inputs(fields)), pixels, path)
    }
    logger.info("Tiled {} step {}", stream, step)
  }

  val ifsSteps = steps.getValue(EcmwfStream.IFS)
  val stepHours = ifsSteps[1] - ifsSteps[0]
  for (layer in LOOKAHEAD_LAYERS) {
    val inputs = history.getValue(layer.input)
    for (step in ifsSteps) {
      val windows =
          layer.windows.map { hours -> (step..step + hours step stepHours).map(inputs::get) }
      // The window runs past the last step we tiled.
      if (windows.any { window -> window.any { it == null } }) {
        continue
      }
      val values = windows.flatMap { window -> layer.combine(window.map { it!! }) }
      val path = output.value.resolve("${layer.name}_${step}.mbtiles")
      writeLayer(layer.name, layer.channels, values, pixels, path)
    }
    logger.info("Tiled {}", layer.name)
  }

  // Keep in sync with ecmwf.sh, which names the archives after this run
  Files.writeString(output.value.resolve("run"), run.id)
}

/** Where on the grid each pixel of one tile lands, as fractional rows and columns. */
private class TilePixels(val x: Int, val y: Int, val z: Int) {

  val rows = FloatArray(TILE_SIZE * TILE_SIZE)
  val columns = FloatArray(TILE_SIZE * TILE_SIZE)

  init {
    for (py in 0 until TILE_SIZE) {
      val lat = tileLat(y + (py + 0.5) / TILE_SIZE, z)
      for (px in 0 until TILE_SIZE) {
        val lng = (x + (px + 0.5) / TILE_SIZE) / (1 shl z) * 360 - 180
        rows[py * TILE_SIZE + px] = ((90 - lat) / GRID_DEGREES).toFloat()
        columns[py * TILE_SIZE + px] = ((lng + 180) / GRID_DEGREES).toFloat()
      }
    }
  }
}

private fun tilePixels(): List<TilePixels> {
  val tiles = ArrayList<TilePixels>()
  for (z in 0..MAX_ZOOM) {
    for (x in 0 until (1 shl z)) {
      for (y in 0 until (1 shl z)) {
        tiles.add(TilePixels(x, y, z))
      }
    }
  }
  return tiles
}

private fun writeLayer(
    name: String,
    channels: List<Channel>,
    values: List<FloatArray>,
    tiles: List<TilePixels>,
    path: Path) {
  Files.deleteIfExists(path)
  MbtilesWriter(path).use { mbtiles ->
    mbtiles.setMetadata("name", name)
    // WebP because it's lossless, which data needs, and 30% smaller than PNG
    mbtiles.setMetadata("format", "webp")
    mbtiles.setMetadata("minzoom", "0")
    mbtiles.setMetadata("maxzoom", MAX_ZOOM.toString())
    tiles.parallelStream().forEach { tile ->
      val image = BufferedImage(TILE_SIZE, TILE_SIZE, BufferedImage.TYPE_INT_RGB)
      val rgb = (image.raster.dataBuffer as DataBufferInt).data
      var shift = 24
      var c = 0
      while (c < channels.size) {
        val channel = channels[c]
        shift -= channel.bits
        if (channel.interpolation == Interpolation.VECTOR) {
          val north = channels[c + 1]
          val northShift = shift - north.bits
          val vector = DoubleArray(2)
          for (i in rgb.indices) {
            sampleVector(values[c], values[c + 1], tile.rows[i], tile.columns[i], vector)
            rgb[i] =
                rgb[i] or (channel.pack(vector[0]) shl shift) or
                    (north.pack(vector[1]) shl northShift)
          }
          shift = northShift
          c += 2
        } else {
          for (i in rgb.indices) {
            val value = sample(values[c], tile.rows[i], tile.columns[i], channel.interpolation)
            rgb[i] = rgb[i] or (channel.pack(value) shl shift)
          }
          c += 1
        }
      }
      mbtiles.insertTile(tile.x, tile.y, tile.z, encodeWebp(image))
    }
  }
}

/** Blends the four grid points around a spot, leaving out NaNs such as land in wave fields. */
private fun sample(values: FloatArray, row: Float, column: Float, how: Interpolation): Double {
  if (how == Interpolation.NEAREST) {
    val r0 = floor(row).toInt().coerceIn(0, GRID_ROWS - 1)
    val r1 = (r0 + 1).coerceAtMost(GRID_ROWS - 1)
    val c0 = floor(column).toInt()
    val r = if (row - floor(row) < 0.5) r0 else r1
    val c = (if (column - c0 < 0.5) c0 else c0 + 1).mod(GRID_COLUMNS)
    return values[r * GRID_COLUMNS + c].toDouble()
  }

  var sum = 0.0
  var sumSin = 0.0
  var sumCos = 0.0
  var weights = 0.0
  forEachCorner(row, column) { i, weight ->
    val value = values[i]
    if (value.isNaN()) {
      return@forEachCorner
    }
    if (how == Interpolation.ANGLE) {
      sumSin += weight * sin(value * PI / 180)
      sumCos += weight * cos(value * PI / 180)
    } else {
      sum += weight * value
    }
    weights += weight
  }
  if (weights == 0.0) {
    return Double.NaN
  }
  return if (how == Interpolation.ANGLE) {
    (atan2(sumSin, sumCos) * 180 / PI).mod(360.0)
  } else {
    sum / weights
  }
}

// Blends the four vectors around a spot, with a length blended from theirs
private fun sampleVector(
    u: FloatArray, v: FloatArray, row: Float, column: Float, out: DoubleArray) {
  var sumU = 0.0
  var sumV = 0.0
  var sumLength = 0.0
  var weights = 0.0
  forEachCorner(row, column) { i, weight ->
    val cu = u[i].toDouble()
    val cv = v[i].toDouble()
    if (cu.isNaN() || cv.isNaN()) {
      return@forEachCorner
    }
    sumU += weight * cu
    sumV += weight * cv
    sumLength += weight * sqrt(cu * cu + cv * cv)
    weights += weight
  }
  if (weights == 0.0) {
    out[0] = Double.NaN
    out[1] = Double.NaN
    return
  }
  val norm = sqrt(sumU * sumU + sumV * sumV)
  // calm air has no direction to stretch
  val stretch = if (norm > 0) sumLength / weights / norm else 0.0
  out[0] = sumU * stretch
  out[1] = sumV * stretch
}

// Visits the index and bilinear weight of each of the four grid points around a spot
private inline fun forEachCorner(row: Float, column: Float, visit: (Int, Double) -> Unit) {
  val r0 = floor(row).toInt().coerceIn(0, GRID_ROWS - 1)
  val r1 = (r0 + 1).coerceAtMost(GRID_ROWS - 1)
  val c0 = floor(column).toInt()
  val fr = row - floor(row)
  val fc = column - c0
  for (corner in 0 until 4) {
    val r = if (corner < 2) r0 else r1
    val c = (c0 + corner % 2).mod(GRID_COLUMNS)
    val weight = (if (corner < 2) 1 - fr else fr) * (if (corner % 2 == 0) 1 - fc else fc).toDouble()
    visit(r * GRID_COLUMNS + c, weight)
  }
}

private fun encodeWebp(image: BufferedImage): ByteArray {
  val writer = ImageIO.getImageWritersByMIMEType("image/webp").next()
  val param = WebPWriteParam(writer.locale)
  param.compressionMode = ImageWriteParam.MODE_EXPLICIT
  param.compressionType = CompressionType.Lossless
  // The defaults are libwebp's slowest settings, which took 185 ms a tile where these take 21 ms,
  // for tiles only 3% smaller.
  param.method = 2
  param.compressionQuality = 0.5f
  val bytes = ByteArrayOutputStream()
  MemoryCacheImageOutputStream(bytes).use {
    writer.output = it
    writer.write(null, IIOImage(image, null, null), param)
  }
  writer.dispose()
  return bytes.toByteArray()
}

// y is in tiles and can be fractional
private fun tileLat(y: Double, z: Int): Double =
    Math.toDegrees(atan(sinh(PI * (1 - 2 * y / (1 shl z)))))
