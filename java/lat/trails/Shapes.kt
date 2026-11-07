package lat.trails

import com.google.common.geometry.S2Polygon
import com.google.protobuf.ByteString
import io.javalin.http.BadRequestResponse
import io.javalin.http.NotFoundResponse
import java.io.ByteArrayInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.sql.Connection
import lat.trails.proto.Bound
import lat.trails.proto.GetShapeRequest
import lat.trails.proto.GetShapeResponse
import lat.trails.proto.LatLng
import lat.trails.proto.Polylines
import lat.trails.proto.SearchResultKind
import org.trailcatalog.common.DeltaLatLngE7

fun getShape(request: GetShapeRequest, connection: Connection, epoch: Int): GetShapeResponse {
  return when (request.kind) {
    SearchResultKind.SEARCH_RESULT_KIND_BOUNDARY -> getBoundaryShape(request.id, connection, epoch)
    SearchResultKind.SEARCH_RESULT_KIND_POINT -> getPointShape(request.id, connection, epoch)
    SearchResultKind.SEARCH_RESULT_KIND_TRAIL -> getTrailShape(request.id, connection, epoch)
    else -> throw BadRequestResponse("No shape for ${request.kind}")
  }
}

private fun getBoundaryShape(id: Long, connection: Connection, epoch: Int): GetShapeResponse {
  return connection
      .prepareStatement("SELECT name, type, s2_polygon FROM boundaries WHERE id = ? AND epoch = ?")
      .apply {
        setLong(1, id)
        setInt(2, epoch)
      }
      .executeQuery()
      .use {
        if (!it.next()) {
          throw NotFoundResponse()
        }
        val polygon = it.getBytes(3)
        val bound = S2Polygon.decode(ByteArrayInputStream(polygon)).rectBound
        GetShapeResponse.newBuilder()
            .setName(it.getString(1))
            .setType(it.getInt(2))
            .setS2Polygon(ByteString.copyFrom(polygon))
            .setBound(
                Bound.newBuilder()
                    .setLowLatDegrees(bound.latLo().degrees())
                    .setLowLngDegrees(bound.lngLo().degrees())
                    .setHighLatDegrees(bound.latHi().degrees())
                    .setHighLngDegrees(bound.lngHi().degrees()))
            .build()
      }
}

private fun getPointShape(id: Long, connection: Connection, epoch: Int): GetShapeResponse {
  return connection
      .prepareStatement(
          "SELECT name, type, marker_degrees_e7 FROM points WHERE id = ? AND epoch = ?")
      .apply {
        setLong(1, id)
        setInt(2, epoch)
      }
      .executeQuery()
      .use {
        if (!it.next()) {
          throw NotFoundResponse()
        }
        // lat then lng
        val marker = ByteBuffer.wrap(it.getBytes(3)).order(ByteOrder.LITTLE_ENDIAN).asIntBuffer()
        val lat = marker.get(0) / 1e7
        val lng = marker.get(1) / 1e7
        GetShapeResponse.newBuilder()
            // The display name is the bare name tag, which a point can lack while it has others.
            .setName(it.getString(1) ?: "")
            .setType(it.getInt(2))
            .setPoint(LatLng.newBuilder().setLatDegrees(lat).setLngDegrees(lng))
            .setBound(
                Bound.newBuilder()
                    .setLowLatDegrees(lat)
                    .setLowLngDegrees(lng)
                    .setHighLatDegrees(lat)
                    .setHighLngDegrees(lng))
            .build()
      }
}

private fun getTrailShape(id: Long, connection: Connection, epoch: Int): GetShapeResponse {
  val response = GetShapeResponse.newBuilder()
  val pathIds =
      connection
          .prepareStatement(
              """
              SELECT name, type, path_ids, bound_degrees_e7
              FROM trails
              WHERE id = ? AND epoch = ?
              """)
          .apply {
            setLong(1, id)
            setInt(2, epoch)
          }
          .executeQuery()
          .use {
            if (!it.next()) {
              throw NotFoundResponse()
            }
            // low lat, low lng, high lat, high lng
            val bound =
                ByteBuffer.wrap(it.getBytes(4)).order(ByteOrder.LITTLE_ENDIAN).asIntBuffer()
            response
                .setName(it.getString(1))
                .setType(it.getInt(2))
                .setBound(
                    Bound.newBuilder()
                        .setLowLatDegrees(bound.get(0) / 1e7)
                        .setLowLngDegrees(bound.get(1) / 1e7)
                        .setHighLatDegrees(bound.get(2) / 1e7)
                        .setHighLngDegrees(bound.get(3) / 1e7))
            val ids = ByteBuffer.wrap(it.getBytes(3)).order(ByteOrder.LITTLE_ENDIAN).asLongBuffer()
            LongArray(ids.remaining()).also { array -> ids.get(array) }
          }

  // Keyed by the path's own id, which leaves clear the low bit that marks a backward path
  val paths = HashMap<Long, IntArray>()
  connection
      .prepareStatement("SELECT id, lat_lng_degrees FROM paths WHERE id = ANY(?) AND epoch = ?")
      .apply {
        val unoriented = pathIds.map { it and 1L.inv() }.distinct().toTypedArray()
        setArray(1, connection.createArrayOf("BIGINT", unoriented))
        setInt(2, epoch)
      }
      .executeQuery()
      .use {
        while (it.next()) {
          paths[it.getLong(1)] = DeltaLatLngE7.decode(it.getBytes(2))
        }
      }

  val polylines = Polylines.newBuilder()
  var run = ArrayList<IntArray>()
  for (pathId in pathIds) {
    val path = paths[pathId and 1L.inv()] ?: continue
    if (path.isEmpty()) {
      continue
    }

    val oriented = if (pathId and 1L == 0L) path else reversePoints(path)
    val last = run.lastOrNull()
    if (last != null
        && (last[last.size - 2] != oriented[0] || last[last.size - 1] != oriented[1])) {
      polylines.addRuns(joinPaths(run))
      run = ArrayList()
    }
    run.add(oriented)
  }
  if (run.isNotEmpty()) {
    polylines.addRuns(joinPaths(run))
  }
  return response.setPolylines(polylines).build()
}

private fun reversePoints(latLngE7: IntArray): IntArray {
  val reversed = IntArray(latLngE7.size)
  for (i in 0 until latLngE7.size step 2) {
    reversed[latLngE7.size - 2 - i] = latLngE7[i]
    reversed[latLngE7.size - 1 - i] = latLngE7[i + 1]
  }
  return reversed
}

// Each path after the first starts on the node the one before it ended on, so that point is
// dropped.
private fun joinPaths(run: List<IntArray>): ByteString {
  val joined = IntArray(run[0].size + run.drop(1).sumOf { it.size - 2 })
  run[0].copyInto(joined)
  var at = run[0].size
  for (path in run.drop(1)) {
    path.copyInto(joined, at, startIndex = 2)
    at += path.size - 2
  }
  return ByteString.copyFrom(DeltaLatLngE7.encode(joined))
}
