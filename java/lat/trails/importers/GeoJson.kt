package lat.trails.importers

import com.fasterxml.jackson.databind.ObjectMapper
import com.google.common.geometry.S2CellId
import com.google.common.geometry.S2CellUnion
import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2Point
import com.google.common.geometry.S2Polyline
import com.google.common.geometry.S2RegionCoverer
import java.io.ByteArrayOutputStream
import java.util.Comparator
import java.util.UUID
import lat.trails.common.COLLECTION_COVERING_MAX_LEVEL
import lat.trails.common.FEATURE_COVERING_MAX_LEVEL
import lat.trails.common.createConnection
import org.apache.commons.text.StringEscapeUtils
import org.slf4j.LoggerFactory
import org.trailcatalog.common.DelegatingEncodedOutputStream
import org.trailcatalog.flags.parseFlags
import org.trailcatalog.importers.basemap.StringifyingInputStream
import org.trailcatalog.importers.basemap.appendByteArray
import org.trailcatalog.importers.basemap.copyStreamToPg
import org.trailcatalog.importers.basemap.toLatLngE7
import org.trailcatalog.s2.polylineToCell

private val logger = LoggerFactory.getLogger("GeoJson")

data class Line(
  val cell: S2CellId,
  val covering: S2CellUnion,
  val id: UUID,
  val line: S2Polyline,
)

fun main(args: Array<String>) {
  parseFlags(args)

  val coverer = S2RegionCoverer.builder().setMaxLevel(FEATURE_COVERING_MAX_LEVEL).build()
  val root = ObjectMapper().readTree(source.value!!.toFile())
  val lines = ArrayList<Line>()
  for (feature in root.get("features")) {
    if (feature.get("type").textValue() != "Feature") {
      continue
    }
    val geometry = feature.get("geometry")
    if (geometry.get("type").textValue() != "LineString") {
      continue
    }
    val points = ArrayList<S2Point>()
    for (coordinate in geometry.get("coordinates")) {
      points.add(
              S2LatLng.fromDegrees(
                coordinate.get(0).doubleValue(),
                coordinate.get(1).doubleValue())
          .toPoint())
    }
    val polyline = S2Polyline(points)
    lines.add(
      Line(
        cell = polylineToCell(polyline),
        covering = coverer.getCovering(polyline),
        id = UUID.fromString(feature.get("id").textValue()),
        line = polyline,
      ))
  }

  val covering = HashSet<S2CellId>()
  for (feature in lines) {
    val cell = feature.cell;
    covering.add(cell.parent(COLLECTION_COVERING_MAX_LEVEL.coerceAtMost(cell.level())))
  }
  dumpLines(ArrayList(covering), lines)
}

private fun dumpLines(covering: MutableList<S2CellId>, lines: List<Line>) {
  createConnection().use { hikari ->
    val collection =
        hikari.connection
            .prepareStatement(
                "INSERT INTO collections (id, creator, name, covering) "
                    + "VALUES (COALESCE(?, gen_random_uuid()), ?, ?, ?) "
                    + "RETURNING id")
            .apply {
              setObject(
                1,
                if (collectionId.value != null)
                  UUID.fromString(collectionId.value)
                else
                  null)
              setObject(
                2,
                if (creatorId.value != null)
                  UUID.fromString(creatorId.value)
                else
                  UUID(0, 0)
              )
              setString(3, "Alatna River Trip")
              setBytes(
                  4,
                  ByteArrayOutputStream().also {
                    DelegatingEncodedOutputStream(it).use {
                      covering.sortWith(Comparator.naturalOrder())
                      it.writeVarInt(1)
                      it.writeVarInt(covering.size)
                      for (cell in covering) {
                        it.writeLong(cell.id())
                      }
                    }
                  }.toByteArray())
            }
            .executeQuery()
            .use {
              it.next()
              it.getString(1)
            }

    val mapper = ObjectMapper()
    val stream = StringifyingInputStream(lines.iterator()) { line, csv ->
      // id,collection,cell,created,data,lat_lng_degrees
      csv.append(line.id)
      csv.append(",")
      csv.append(collection)
      csv.append(",")
      csv.append(line.cell.id())
      csv.append(",now(),")
      csv.append(StringEscapeUtils.escapeCsv(mapper.writeValueAsString(HashMap<String, String>())))
      csv.append(",")
      appendByteArray(ByteArrayOutputStream().also {
        for (point in line.line.vertices()) {
          val e7 = point.toLatLngE7()
          it.write(e7.lat)
          it.write(e7.lng)
        }
      }.toByteArray(), csv)
      csv.append("\n")
    }
    copyStreamToPg("lines", stream, hikari)
  }
}
