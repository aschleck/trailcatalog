package lat.trails.importers

import com.fasterxml.jackson.databind.ObjectMapper
import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2LatLngRect
import com.google.common.geometry.S2Polygon
import java.io.ByteArrayOutputStream
import java.nio.file.Path
import java.util.UUID
import lat.trails.common.BOUND_COLUMNS
import lat.trails.common.appendBound
import lat.trails.common.assemblePolygon
import lat.trails.common.createBaseConnection
import lat.trails.common.encodeCovering
import lat.trails.common.setBound
import mil.nga.sf.MultiPolygon
import org.apache.commons.text.StringEscapeUtils
import org.locationtech.proj4j.CoordinateTransform
import org.locationtech.proj4j.ProjCoordinate
import org.postgresql.copy.CopyManager
import org.postgresql.jdbc.PgConnection
import org.trailcatalog.flags.FlagSpec
import org.trailcatalog.flags.createNullableFlag
import org.trailcatalog.importers.basemap.StringifyingInputStream
import org.trailcatalog.importers.basemap.appendByteArray
import org.trailcatalog.s2.polygonToCell

// Shared by the importers that load a GeoPackage of polygons into a new collection

@FlagSpec(name = "collection_id")
val collectionId = createNullableFlag(null as String?)

@FlagSpec(name = "creator_id")
val creatorId = createNullableFlag(null as String?)

@FlagSpec(name = "source")
val source = createNullableFlag(null as Path?)

/** Converts a GeoPackage geometry, reprojecting it to WGS84 with transform if given. */
fun toS2Polygon(geometry: MultiPolygon, transform: CoordinateTransform?): S2Polygon {
  return assemblePolygon(geometry.polygons.map { polygon ->
    polygon.rings.map { ring ->
      ring.points.map {
        if (transform == null) {
          S2LatLng.fromDegrees(it.y, it.x).toPoint()
        } else {
          val destination = transform.transform(ProjCoordinate(it.x, it.y), ProjCoordinate())
          S2LatLng.fromDegrees(destination.y, destination.x).toPoint()
        }
      }
    }
  })
}

/**
 * Inserts a new collection named name holding polygons, each with its data. schema is the JSON for
 * collections.schema, see schema.ts#CollectionSchema.
 */
fun dumpPolygons(
    name: String,
    schema: Map<String, Any>,
    polygons: List<Pair<Map<String, String>, S2Polygon>>,
) {
  val mapper = ObjectMapper()
  createBaseConnection().use { hikari ->
    hikari.connection.use { connection ->
      // One transaction so a failed copy doesn't leave an empty collection behind
      connection.autoCommit = false
      val collection =
          connection
              .prepareStatement(
                  "INSERT INTO collections "
                      + "(id, creator, name, covering, schema, $BOUND_COLUMNS) "
                      + "VALUES (COALESCE(?, gen_random_uuid()), ?, ?, ?, ?::jsonb, ?, ?, ?, ?) "
                      + "RETURNING id")
              .apply {
                setObject(1, collectionId.value?.let { UUID.fromString(it) })
                setObject(2, creatorId.value?.let { UUID.fromString(it) } ?: UUID(0, 0))
                setString(3, name)
                setBytes(4, encodeCovering(polygons.map { polygonToCell(it.second) }))
                setString(5, mapper.writeValueAsString(schema))
                setBound(
                    6,
                    polygons.fold(S2LatLngRect.empty()) { bound, (_, polygon) ->
                      bound.union(polygon.rectBound)
                    })
              }
              .executeQuery()
              .use {
                it.next()
                it.getString(1)
              }

      val stream = StringifyingInputStream(polygons.iterator()) { (data, polygon), csv ->
        // id,collection,cell,data,s2_polygon,low_lat_degrees,low_lng_degrees,high_lat_degrees,
        // high_lng_degrees
        csv.append(UUID.randomUUID())
        csv.append(",")
        csv.append(collection)
        csv.append(",")
        csv.append(polygonToCell(polygon).id())
        csv.append(",")
        csv.append(StringEscapeUtils.escapeCsv(mapper.writeValueAsString(data)))
        csv.append(",")
        appendByteArray(ByteArrayOutputStream().also { polygon.encode(it) }.toByteArray(), csv)
        csv.append(",")
        appendBound(polygon.rectBound, csv)
        csv.append("\n")
      }
      // COPY can't write into views, and the connection's schema only has views, so we name the
      // public table directly.
      CopyManager(connection.unwrap(PgConnection::class.java))
          .copyIn(
              "COPY public.polygons (id, collection, cell, data, s2_polygon, $BOUND_COLUMNS) "
                  + "FROM STDIN WITH (FORMAT CSV, HEADER)",
              stream)
      connection.commit()
    }
  }
}
