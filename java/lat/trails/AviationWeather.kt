package lat.trails

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import io.javalin.http.BadRequestResponse
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration
import java.time.Instant
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import lat.trails.proto.AviationCloud
import lat.trails.proto.AviationConditions
import lat.trails.proto.GetAviationWeatherRequest
import lat.trails.proto.GetAviationWeatherResponse
import lat.trails.proto.Metar
import lat.trails.proto.Taf
import lat.trails.proto.TafPeriod

// https://aviationweather.gov/data/api/
private const val API_URL = "https://aviationweather.gov/api/data/"

// Stations report hourly and specials and amendments come in between, so five minutes is fresh
// enough, and it keeps a popular station from spending the Aviation Weather Center's 100 requests a
// minute.
private val CACHE_DURATION = Duration.ofMinutes(5)

private val STATION_PATTERN = Regex("[A-Z0-9]{3,4}")

private val client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build()

// Keyed by product and station. Null for a station with nothing recent, so that we don't ask again
// for it either.
private val cache = ConcurrentHashMap<Pair<String, String>, Pair<Instant, JsonNode?>>()

fun getAviationWeather(request: GetAviationWeatherRequest): GetAviationWeatherResponse {
  val station = request.station.uppercase()
  if (!STATION_PATTERN.matches(station)) {
    throw BadRequestResponse("Bad station ${request.station}")
  }

  val metar = if (request.metar) fetchCached("metar", station) else null
  val taf = if (request.taf) fetchCached("taf", station) else null
  val response = GetAviationWeatherResponse.newBuilder()
  metar?.join()?.let { response.metar = toMetar(it) }
  taf?.join()?.let { response.taf = toTaf(it) }
  return response.build()
}

private fun fetchCached(product: String, station: String): CompletableFuture<JsonNode?> {
  val key = product to station
  val now = Instant.now()
  val cached = cache[key]
  if (cached != null && cached.first.plus(CACHE_DURATION).isAfter(now)) {
    return CompletableFuture.completedFuture(cached.second)
  }

  return client
      .sendAsync(
          HttpRequest.newBuilder(URI.create("${API_URL}${product}?format=json&ids=${station}"))
              .header("User-Agent", "trails.lat")
              .timeout(Duration.ofSeconds(10))
              .build(),
          HttpResponse.BodyHandlers.ofString())
      .thenApply { response ->
        // The API answers 204 with no body for a station that hasn't published recently.
        val report =
            when (response.statusCode()) {
              200 -> ObjectMapper().readTree(response.body()).firstOrNull()
              204 -> null
              else ->
                throw IllegalStateException(
                    "${product} for ${station} failed with ${response.statusCode()}")
            }
        cache[key] = now to report
        report
      }
}

private fun toMetar(report: JsonNode): Metar {
  val metar = Metar.newBuilder()
  metar.raw = report.path("rawOb").asText()
  metar.observedEpochSeconds = report.path("obsTime").asLong()
  metar.flightCategory = report.text("fltCat")
  report.number("temp")?.let { metar.temperatureCelsius = it }
  report.number("dewp")?.let { metar.dewpointCelsius = it }
  report.number("altim")?.let { metar.altimeterHpa = it }
  metar.conditions = toConditions(report)
  return metar.build()
}

private fun toTaf(report: JsonNode): Taf {
  val taf = Taf.newBuilder()
  taf.raw = report.path("rawTAF").asText()
  taf.issuedEpochSeconds = Instant.parse(report.path("issueTime").asText()).epochSecond
  taf.validFromEpochSeconds = report.path("validTimeFrom").asLong()
  taf.validToEpochSeconds = report.path("validTimeTo").asLong()
  for (forecast in report.path("fcsts")) {
    val period = TafPeriod.newBuilder()
    period.fromEpochSeconds = forecast.path("timeFrom").asLong()
    period.toEpochSeconds = forecast.path("timeTo").asLong()
    period.change = forecast.text("fcstChange")
    forecast.number("timeBec")?.let { period.becomingEpochSeconds = it.toLong() }
    forecast.number("probability")?.let { period.probabilityPercent = it.toInt() }
    period.conditions = toConditions(forecast)
    taf.addPeriods(period)
  }
  return taf.build()
}

// Reads the fields METARs and TAF periods share.
private fun toConditions(report: JsonNode): AviationConditions {
  val conditions = AviationConditions.newBuilder()
  // wdir is "VRB" when variable, and 0 with no speed when calm
  report.number("wdir")?.takeIf { it > 0 }?.let { conditions.windDirectionDegrees = it.toInt() }
  report.number("wspd")?.let { conditions.windSpeedKnots = it.toInt() }
  report.number("wgst")?.let { conditions.windGustKnots = it.toInt() }
  conditions.visibility = report.text("visib")
  conditions.weather = report.text("wxString")
  for (cloud in report.path("clouds")) {
    val built = AviationCloud.newBuilder().setCover(cloud.path("cover").asText())
    cloud.number("base")?.let { built.baseFeet = it.toInt() }
    conditions.addClouds(built)
  }
  return conditions.build()
}

private fun JsonNode.number(key: String): Double? = get(key)?.takeIf { it.isNumber }?.asDouble()

private fun JsonNode.text(key: String): String =
    get(key)?.takeUnless { it.isNull }?.asText()?.trim() ?: ""
