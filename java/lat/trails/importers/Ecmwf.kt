package lat.trails.importers

import com.fasterxml.jackson.databind.ObjectMapper
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import org.slf4j.LoggerFactory
import ucar.nc2.grib.grib2.Grib2Gds
import ucar.nc2.grib.grib2.Grib2RecordScanner
import ucar.unidata.io.InMemoryRandomAccessFile

private val logger = LoggerFactory.getLogger("Ecmwf")
private val mapper = ObjectMapper()

// https://www.ecmwf.int/en/forecasts/datasets/open-data
private const val BUCKET = "https://storage.googleapis.com/ecmwf-open-data"

const val GRID_COLUMNS = 1440
const val GRID_ROWS = 721
const val GRID_DEGREES = 0.25

// ECMWF names gusts by how long they cover: 10fg is the last hour through step 90, 10fg3 the last
// 3 hours through 144, and 10fg the last 6 after that. We read them all as 10fg.
private val ALIASES = mapOf("10fg3" to "10fg")

// Fields closer than this in a file are fetched with one request, because a megabyte of waste is
// cheaper than the round trip and keeps us under the bucket's request rate.
private const val COALESCE_GAP_BYTES = 1_000_000L

/** A stream of the open data, which ECMWF publishes in its own directory per run. */
enum class EcmwfStream(val directory: String, val suffix: String) {
  AIFS("aifs-single/0p25/oper", "oper-fc"),
  IFS("ifs/0p25/oper", "oper-fc"),
  WAVE("ifs/0p25/wave", "wave-fc"),
}

/** Names a field the way the .index files do, with no level for single level fields. */
data class FieldKey(val param: String, val level: Int? = null)

/**
 * A field on the 0.25 degree grid. Row 0 is 90 degrees north and column 0 is 180 degrees west.
 * Values over land in wave fields are NaN.
 */
class Field(val values: FloatArray) {

  init {
    check(values.size == GRID_COLUMNS * GRID_ROWS) { "Fields hold ${values.size} values" }
  }

  operator fun get(row: Int, column: Int): Float = values[row * GRID_COLUMNS + column]
}

/** Formats a run's start the way the bucket's paths do, as 20261015 and 18z. */
class EcmwfRun(val start: Instant) {

  val day: String = DateTimeFormatter.ofPattern("yyyyMMdd").withZone(ZoneOffset.UTC).format(start)
  val hour: String = "%02d".format(start.atZone(ZoneOffset.UTC).hour)
  val id = "${day}${hour}"

  fun url(stream: EcmwfStream, step: Int, extension: String): String {
    return "${BUCKET}/${day}/${hour}z/${stream.directory}/${day}${hour}0000-${step}h-" +
        "${stream.suffix}.${extension}"
  }

  /** Reads the given fields at one step, skipping any the step doesn't have. */
  fun read(stream: EcmwfStream, step: Int, keys: Collection<FieldKey>): Map<FieldKey, Field> {
    val entries = readIndex(stream, step).filterKeys { it in keys }
    val url = url(stream, step, "grib2")
    val fields = HashMap<FieldKey, Field>()
    for (batch in coalesce(entries.values)) {
      val start = batch.first().offset
      val end = batch.last().offset + batch.last().length
      val bytes = fetchRange(url, start, end - start)
      for (entry in batch) {
        val offset = (entry.offset - start).toInt()
        fields[entry.key] = decode(bytes.copyOfRange(offset, offset + entry.length.toInt()))
      }
    }
    return fields
  }

  /** Checks that a step's index is published, which ECMWF does last for each file. */
  fun hasStep(stream: EcmwfStream, step: Int): Boolean {
    return try {
      readIndex(stream, step).isNotEmpty()
    } catch (e: IllegalStateException) {
      false
    }
  }

  private fun readIndex(stream: EcmwfStream, step: Int): Map<FieldKey, IndexEntry> {
    val text = fetchBytes(url(stream, step, "index")).toString(Charsets.UTF_8)
    val entries = HashMap<FieldKey, IndexEntry>()
    for (line in text.lineSequence().filter { it.isNotBlank() }) {
      val json = mapper.readTree(line)
      val param = json["param"].asText()
      val key = FieldKey(ALIASES[param] ?: param, json["levelist"]?.asText()?.toInt())
      entries[key] = IndexEntry(key, json["_offset"].asLong(), json["_length"].asLong())
    }
    return entries
  }
}

/** Finds the newest run that has published every step we need from every stream. */
fun findNewestRun(now: Instant, steps: Map<EcmwfStream, List<Int>>): EcmwfRun {
  // ECMWF starts a run every 6 hours and publishes it over the following 6 to 9.
  var start = now.truncatedTo(ChronoUnit.HOURS)
  start = start.minus(start.atZone(ZoneOffset.UTC).hour % 6L, ChronoUnit.HOURS)
  repeat(8) {
    val run = EcmwfRun(start)
    if (steps.all { (stream, wanted) -> run.hasStep(stream, wanted.last()) }) {
      return run
    }
    logger.info("Run {} is incomplete", run.id)
    start = start.minus(6, ChronoUnit.HOURS)
  }
  throw IllegalStateException("No run in the last two days has every step")
}

private data class IndexEntry(val key: FieldKey, val offset: Long, val length: Long)

private fun coalesce(entries: Collection<IndexEntry>): List<List<IndexEntry>> {
  val batches = ArrayList<MutableList<IndexEntry>>()
  for (entry in entries.sortedBy { it.offset }) {
    val last = batches.lastOrNull()?.last()
    if (last != null && entry.offset - (last.offset + last.length) < COALESCE_GAP_BYTES) {
      batches.last().add(entry)
    } else {
      batches.add(mutableListOf(entry))
    }
  }
  return batches
}

private fun decode(bytes: ByteArray): Field {
  val raf = InMemoryRandomAccessFile("ecmwf", bytes)
  val record = Grib2RecordScanner(raf).next()
  val gds = record.gds as Grib2Gds.LatLon
  // Keep in sync with Field, which reads row 0 as north and column 0 as 180 degrees west
  check(gds.nx == GRID_COLUMNS && gds.ny == GRID_ROWS) { "Grid is ${gds.nx}x${gds.ny}" }
  check(gds.la1 == 90f && gds.lo1 == 180f && gds.deltaLat < 0) { "Grid starts at ${gds.la1}" }
  check(record.scanMode == 0) { "Scanning mode ${record.scanMode} is unsupported" }
  return Field(record.readData(raf))
}
