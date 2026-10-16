package lat.trails.importers

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.sqrt

// Pressure levels in hPa, bottom to top. We stop at 150 because nothing we draw lives above it.
private val LEVELS = listOf(1000, 925, 850, 700, 600, 500, 400, 300, 250, 200, 150)
// About 5,000 to 30,000 feet
private val ICING_LEVELS = listOf(850, 700, 600, 500, 400, 300)
// Pairs of levels, about 24,000 to 44,000 feet, where jet streams make clear air turbulence
private val TURBULENCE_LAYERS = listOf(400 to 300, 300 to 250, 250 to 200, 200 to 150)

private const val EARTH_RADIUS_METERS = 6_371_008.8
private const val GRAVITY = 9.80665
private const val FREEZING_KELVIN = 273.15
// Dry air cools 9.8 K per km as it rises.
private const val DRY_LAPSE_KELVIN_PER_METER = 0.0098
// Windy's thermal layer lifts a parcel 2 K warmer than the air at the surface.
private const val THERMAL_EXCESS_KELVIN = 2.0
// Espy's approximation of how far a parcel rises before it condenses, per K of dew point spread
private const val LCL_METERS_PER_KELVIN = 125.0

/** How a channel's values are blended when we resample the grid into tiles. */
enum class Interpolation {
  // in degrees, blended as unit vectors so 359 and 1 average to 0
  ANGLE,
  LINEAR,
  // for categories, where a blend of two codes means nothing
  NEAREST,
}

/**
 * Packs a value into bits of a tile pixel as round((value - offset) / scale). The largest code
 * means no data, so the largest value a channel holds is offset + scale * (2^bits - 2).
 */
class Channel(
    val name: String,
    val bits: Int,
    val scale: Double,
    val offset: Double,
    val interpolation: Interpolation = Interpolation.LINEAR,
) {

  val noData = (1 shl bits) - 1

  fun pack(value: Double): Int {
    if (value.isNaN()) {
      return noData
    }
    return Math.round((value - offset) / scale).toInt().coerceIn(0, noData - 1)
  }
}

/** The fields a layer reads at one step. */
class Inputs(private val fields: Map<FieldKey, Field>) {

  operator fun get(param: String): Field = fields[FieldKey(param)] ?: error("Missing ${param}")

  operator fun get(param: String, level: Int): Field =
      fields[FieldKey(param, level)] ?: error("Missing ${param} at ${level} hPa")
}

/**
 * One kind of tile we write per step. Each pixel holds every channel, packed from the high bits
 * of its 24 RGB bits down.
 */
class WeatherLayer(
    val name: String,
    val stream: EcmwfStream,
    // the steps this stream publishes divide by this many hours
    val stepHours: Int,
    val inputs: Set<FieldKey>,
    val channels: List<Channel>,
    // the channels' values on the grid, in the units the channels pack
    val compute: (Inputs) -> List<FloatArray>,
) {

  init {
    check(channels.sumOf { it.bits } <= 24) { "${name} packs more than 24 bits" }
  }
}

/**
 * What happens over the hours after each step, one channel per window. Clients only ever show the
 * step closest to now, so these let them show the coming days without fetching every step.
 */
class LookaheadLayer(
    val name: String,
    val input: FieldKey,
    // in hours, two to an archive so each gets 12 bits
    val windows: List<Int>,
    val scale: Double,
    // from the input at every step from the window's start through its end
    val combine: (List<FloatArray>) -> FloatArray,
) {

  val channels = windows.map { Channel("next_${it}h", 12, scale, 0.0) }
}

private fun maxAfterFirst(fields: List<FloatArray>): FloatArray {
  return FloatArray(fields[0].size) { i -> (1 until fields.size).maxOf { fields[it][i] } }
}

// tp and sf are in meters of water since the run started.
private fun millimetersBetween(fields: List<FloatArray>): FloatArray {
  return FloatArray(fields[0].size) { i -> (fields.last()[i] - fields.first()[i]) * 1000 }
}

// Keep in sync with weather.ts#ECMWF_LAYERS. Each gust field is the strongest in the hours before
// its step, so the strongest in a window leaves out the gust at its start. Through step 90 those
// fields cover one hour in three, so windows there can miss a gust between steps.
val LOOKAHEAD_LAYERS = listOf(
    // in m/s
    LookaheadLayer("peak_gust", FieldKey("10fg"), listOf(12, 24), 0.1, ::maxAfterFirst),
    LookaheadLayer("peak_gust_long", FieldKey("10fg"), listOf(72, 120), 0.1, ::maxAfterFirst),
    // in mm, up to 409 in a day and 2047 in five
    LookaheadLayer("rain", FieldKey("tp"), listOf(12, 24), 0.1, ::millimetersBetween),
    LookaheadLayer("rain_long", FieldKey("tp"), listOf(72, 120), 0.5, ::millimetersBetween),
    // in mm of water
    LookaheadLayer("snowfall", FieldKey("sf"), listOf(12, 24), 0.1, ::millimetersBetween),
    LookaheadLayer("snowfall_long", FieldKey("sf"), listOf(72, 120), 0.5, ::millimetersBetween),
)

// Fields every step of IFS reads once, from step 0, because ECMWF only publishes them there
val STATIC_IFS_INPUTS = setOf(FieldKey("z"))

private fun keys(vararg params: String) = params.map { FieldKey(it) }.toSet()

private fun levelKeys(params: List<String>, levels: List<Int>) =
    params.flatMap { param -> levels.map { FieldKey(param, it) } }.toSet()

private inline fun map(field: Field, transform: (Float) -> Double): FloatArray {
  return FloatArray(field.values.size) { transform(field.values[it]).toFloat() }
}

// Keep in sync with weather.ts#ECMWF_LAYERS
val WEATHER_LAYERS = listOf(
    WeatherLayer(
        "wind",
        EcmwfStream.IFS,
        3,
        keys("10u", "10v"),
        listOf(
            // in m/s, eastward and northward
            Channel("u", 12, 0.1, -204.7),
            Channel("v", 12, 0.1, -204.7),
        )) { listOf(it["10u"].values, it["10v"].values) },
    WeatherLayer(
        "gust",
        EcmwfStream.IFS,
        3,
        keys("10fg"),
        listOf(
            // in m/s, the strongest gust in the hour before, or the 3 hours before past step 90
            Channel("gust", 12, 0.1, 0.0),
        )) { listOf(it["10fg"].values) },
    WeatherLayer(
        "pressure",
        EcmwfStream.IFS,
        3,
        keys("msl"),
        listOf(
            // in hPa at mean sea level
            Channel("pressure", 12, 0.1, 850.0),
        )) { listOf(map(it["msl"]) { pa -> pa / 100.0 }) },
    // Clients derive humidity and wet-bulb temperature from these two.
    WeatherLayer(
        "temperature",
        EcmwfStream.IFS,
        3,
        keys("2t", "2d"),
        listOf(
            // in degrees Celsius at 2 m
            Channel("temperature", 12, 0.05, -100.0),
            Channel("dew_point", 12, 0.05, -100.0),
        )) {
      listOf(
          map(it["2t"]) { k -> k - FREEZING_KELVIN },
          map(it["2d"]) { k -> k - FREEZING_KELVIN })
    },
    WeatherLayer(
        "precipitation",
        EcmwfStream.IFS,
        3,
        keys("tprate", "ptype", "mucape"),
        listOf(
            // in mm/h
            Channel("rate", 14, 0.01, 0.0),
            // https://codes.ecmwf.int/grib/param-db/260015
            Channel("type", 4, 1.0, 0.0, Interpolation.NEAREST),
            // in J/kg, which we draw as a chance of thunder
            Channel("cape", 6, 100.0, 0.0),
        )) {
      listOf(
          map(it["tprate"]) { rate -> rate * 3600.0 },
          it["ptype"].values,
          it["mucape"].values)
    },
    WeatherLayer(
        "snow",
        EcmwfStream.IFS,
        3,
        keys("sd", "rsn"),
        listOf(
            // in cm
            Channel("depth", 12, 1.0, 0.0),
        )) { inputs ->
      val water = inputs["sd"].values
      val density = inputs["rsn"].values
      // sd is meters of water and rsn is kg/m^3, and water is 1000 kg/m^3.
      listOf(FloatArray(water.size) { if (water[it] <= 0) 0f else water[it] * 1e5f / density[it] })
    },
    // AIFS is the only open stream that splits clouds by height.
    WeatherLayer(
        "clouds",
        EcmwfStream.AIFS,
        6,
        keys("tcc", "lcc", "mcc", "hcc"),
        listOf(
            // in percent
            Channel("total", 6, 100.0 / 62, 0.0),
            Channel("low", 6, 100.0 / 62, 0.0),
            Channel("medium", 6, 100.0 / 62, 0.0),
            Channel("high", 6, 100.0 / 62, 0.0),
        )) { listOf(it["tcc"].values, it["lcc"].values, it["mcc"].values, it["hcc"].values) },
    WeatherLayer(
        "thermals",
        EcmwfStream.IFS,
        3,
        keys("2t", "2d") + levelKeys(listOf("t", "gh"), LEVELS) + STATIC_IFS_INPUTS,
        listOf(
            // in m above sea level
            Channel("top", 12, 5.0, 0.0),
            // in m above sea level, missing where thermals stay dry
            Channel("cloud_base", 12, 5.0, 0.0),
        ),
        ::computeThermals),
    WeatherLayer(
        "freezing",
        EcmwfStream.IFS,
        3,
        keys("2t") + levelKeys(listOf("t", "gh"), LEVELS) + STATIC_IFS_INPUTS,
        listOf(
            // in m above sea level, the ground where it's already freezing there
            Channel("altitude", 12, 5.0, 0.0),
        ),
        ::computeFreezingAltitude),
    WeatherLayer(
        "icing",
        EcmwfStream.IFS,
        3,
        levelKeys(listOf("t", "r"), ICING_LEVELS),
        ICING_LEVELS.map {
          // from 0 for none to 15 for the worst
          Channel("${it}hpa", 4, 1.0, 0.0)
        },
        ::computeIcing),
    WeatherLayer(
        "turbulence",
        EcmwfStream.IFS,
        3,
        levelKeys(listOf("u", "v", "gh"), TURBULENCE_LAYERS.flatMap { it.toList() }.distinct()),
        TURBULENCE_LAYERS.map { (bottom, top) ->
          // Ellrod's index in 10^-7 s^-2, where 4 is light and 12 is severe
          Channel("${bottom}_${top}hpa", 6, 0.5, 0.0)
        },
        ::computeTurbulence),
    WeatherLayer(
        "waves",
        EcmwfStream.WAVE,
        3,
        keys("swh", "mwd", "mwp"),
        listOf(
            // in m, combined wind waves and swell
            Channel("height", 9, 0.05, 0.0),
            // in degrees clockwise from north, where the waves come from
            Channel("direction", 8, 360.0 / 254, 0.0, Interpolation.ANGLE),
            // in s
            Channel("period", 7, 0.25, 0.0),
        )) { listOf(it["swh"].values, it["mwd"].values, it["mwp"].values) },
)

/** Heights and temperatures from the ground up through the pressure levels above it. */
private class Profile(inputs: Inputs) {

  private val surfaceHeight = inputs["z"].values
  private val surfaceKelvin = inputs["2t"].values
  private val heights = LEVELS.map { inputs["gh", it].values }
  private val kelvins = LEVELS.map { inputs["t", it].values }

  fun ground(i: Int): Double = surfaceHeight[i] / GRAVITY

  /** Walks the profile at cell i, passing each point's height in m and temperature in K. */
  inline fun walk(i: Int, visit: (Double, Double) -> Boolean) {
    val ground = ground(i)
    if (!visit(ground, surfaceKelvin[i].toDouble())) {
      return
    }
    for (level in LEVELS.indices) {
      val height = heights[level][i].toDouble()
      // Levels below the ground are extrapolated by the model, so we skip them.
      if (height > ground && !visit(height, kelvins[level][i].toDouble())) {
        return
      }
    }
  }
}

private fun computeThermals(inputs: Inputs): List<FloatArray> {
  val profile = Profile(inputs)
  val dewPoint = inputs["2d"].values
  val surface = inputs["2t"].values
  val tops = FloatArray(dewPoint.size)
  val bases = FloatArray(dewPoint.size)
  for (i in tops.indices) {
    val ground = profile.ground(i)
    val start = surface[i] + THERMAL_EXCESS_KELVIN
    var top = ground
    var lastHeight = ground
    var lastExcess = THERMAL_EXCESS_KELVIN
    profile.walk(i) { height, kelvin ->
      val excess = start - DRY_LAPSE_KELVIN_PER_METER * (height - ground) - kelvin
      if (excess <= 0) {
        top = lastHeight + (height - lastHeight) * lastExcess / (lastExcess - excess)
        false
      } else {
        top = height
        lastHeight = height
        lastExcess = excess
        true
      }
    }
    tops[i] = top.toFloat()
    val condensation = ground + LCL_METERS_PER_KELVIN * (surface[i] - dewPoint[i])
    bases[i] = if (condensation < top) condensation.toFloat() else Float.NaN
  }
  return listOf(tops, bases)
}

private fun computeFreezingAltitude(inputs: Inputs): List<FloatArray> {
  val profile = Profile(inputs)
  val altitudes = FloatArray(GRID_COLUMNS * GRID_ROWS)
  for (i in altitudes.indices) {
    var altitude = Double.NaN
    var lastHeight = Double.NaN
    var lastKelvin = Double.NaN
    profile.walk(i) { height, kelvin ->
      if (kelvin > FREEZING_KELVIN) {
        lastHeight = height
        lastKelvin = kelvin
        true
      } else {
        // The first point is the ground, so a NaN last point means it's freezing there.
        altitude =
            if (lastKelvin.isNaN()) {
              height
            } else {
              lastHeight +
                  (height - lastHeight) * (lastKelvin - FREEZING_KELVIN) / (lastKelvin - kelvin)
            }
        false
      }
    }
    altitudes[i] = altitude.toFloat()
  }
  return listOf(altitudes)
}

// Supercooled droplets freeze onto aircraft between 0 and -20 C in saturated air, and most often
// around -8 C. This is the classic temperature and humidity screen, not a forecast of droplets.
private fun computeIcing(inputs: Inputs): List<FloatArray> {
  return ICING_LEVELS.map { level ->
    val kelvins = inputs["t", level].values
    val humidities = inputs["r", level].values
    FloatArray(kelvins.size) {
      val celsius = kelvins[it] - FREEZING_KELVIN
      val wetness = ((humidities[it] - 70.0) / 30.0).coerceIn(0.0, 1.0)
      val coldness = if (celsius > 0) 0.0 else max(0.0, 1 - abs(celsius + 8) / 12)
      (15 * wetness * coldness).toFloat()
    }
  }
}

// https://doi.org/10.1175/1520-0434(1992)007<0150:AOTIFF>2.0.CO;2
private fun computeTurbulence(inputs: Inputs): List<FloatArray> {
  val deformations = HashMap<Int, FloatArray>()
  for (level in TURBULENCE_LAYERS.flatMap { it.toList() }.distinct()) {
    deformations[level] = deformation(inputs["u", level], inputs["v", level])
  }
  return TURBULENCE_LAYERS.map { (bottom, top) ->
    val bottomU = inputs["u", bottom].values
    val bottomV = inputs["v", bottom].values
    val topU = inputs["u", top].values
    val topV = inputs["v", top].values
    val bottomHeight = inputs["gh", bottom].values
    val topHeight = inputs["gh", top].values
    val bottomDeformation = deformations[bottom]!!
    val topDeformation = deformations[top]!!
    FloatArray(bottomU.size) {
      val shear =
          hypot(topU[it] - bottomU[it], topV[it] - bottomV[it]) / (topHeight[it] - bottomHeight[it])
      (shear * (bottomDeformation[it] + topDeformation[it]) / 2 * 1e7).toFloat()
    }
  }
}

/** Total deformation in s^-1, by centered differences on the grid. */
private fun deformation(u: Field, v: Field): FloatArray {
  val out = FloatArray(GRID_COLUMNS * GRID_ROWS)
  val dRadians = GRID_DEGREES * PI / 180
  val dy = 2 * EARTH_RADIUS_METERS * dRadians
  // The poles have no east-west extent, so their rows stay 0.
  for (row in 1 until GRID_ROWS - 1) {
    val lat = (90 - row * GRID_DEGREES) * PI / 180
    val dx = 2 * EARTH_RADIUS_METERS * cos(lat) * dRadians
    for (column in 0 until GRID_COLUMNS) {
      val east = (column + 1) % GRID_COLUMNS
      val west = (column + GRID_COLUMNS - 1) % GRID_COLUMNS
      // Rows run north to south, so north is row - 1.
      val dudx = (u[row, east] - u[row, west]) / dx
      val dvdx = (v[row, east] - v[row, west]) / dx
      val dudy = (u[row - 1, column] - u[row + 1, column]) / dy
      val dvdy = (v[row - 1, column] - v[row + 1, column]) / dy
      val stretching = dudx - dvdy
      val shearing = dvdx + dudy
      out[row * GRID_COLUMNS + column] =
          sqrt(stretching * stretching + shearing * shearing).toFloat()
    }
  }
  return out
}
