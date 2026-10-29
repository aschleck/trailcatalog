package lat.trails.common

import com.google.common.geometry.R1Interval
import com.google.common.geometry.S1Interval
import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2LatLngRect
import java.sql.PreparedStatement
import java.sql.ResultSet

// See 14_bounds.toml.
const val BOUND_COLUMNS = "low_lat_degrees, low_lng_degrees, high_lat_degrees, high_lng_degrees"

// The SET clause of an upsert's ON CONFLICT that takes the inserted row's bound
const val UPDATE_BOUND =
    "low_lat_degrees = EXCLUDED.low_lat_degrees, low_lng_degrees = EXCLUDED.low_lng_degrees, " +
        "high_lat_degrees = EXCLUDED.high_lat_degrees, high_lng_degrees = EXCLUDED.high_lng_degrees"

fun latLngE7Bound(latLngE7: IntArray): S2LatLngRect {
  val builder = S2LatLngRect.Builder.empty()
  for (i in latLngE7.indices step 2) {
    builder.addPoint(S2LatLng.fromE7(latLngE7[i], latLngE7[i + 1]))
  }
  return builder.build()
}

fun PreparedStatement.setBound(index: Int, bound: S2LatLngRect) {
  setDouble(index, bound.latLo().degrees())
  setDouble(index + 1, bound.lngLo().degrees())
  setDouble(index + 2, bound.latHi().degrees())
  setDouble(index + 3, bound.lngHi().degrees())
}

fun ResultSet.getBound(index: Int): S2LatLngRect {
  // A collection's bound can span more than 180 degrees of longitude, and rebuilding it from its
  // corners would give back the other side of the world instead.
  return S2LatLngRect(
      R1Interval(Math.toRadians(getDouble(index)), Math.toRadians(getDouble(index + 2))),
      S1Interval(Math.toRadians(getDouble(index + 1)), Math.toRadians(getDouble(index + 3))))
}

// The four CSV fields of BOUND_COLUMNS, for a COPY
fun appendBound(bound: S2LatLngRect, csv: StringBuilder) {
  csv.append(bound.latLo().degrees())
  csv.append(",")
  csv.append(bound.lngLo().degrees())
  csv.append(",")
  csv.append(bound.latHi().degrees())
  csv.append(",")
  csv.append(bound.lngHi().degrees())
}
