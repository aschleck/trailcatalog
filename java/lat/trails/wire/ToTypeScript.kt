package lat.trails.wire

fun main() {
  println("export const OBJECTS_WIRE_VERSION = ${OBJECTS_WIRE_VERSION};")
  println("export const KIND_UUID_JSON = ${KIND_UUID_JSON};")
  println("export const KIND_PACKED_PATH = ${KIND_PACKED_PATH};")
  println("export const KIND_PACKED_POINT = ${KIND_PACKED_POINT};")

  println("export const TRAILS_LAT_SCHEMA = '${TRAILS_LAT_SCHEMA}';")
  println("export const MAX_LINES_BY_ID = ${MAX_LINES_BY_ID};")
  println("export const WRITE_METHODS = [${WRITE_METHODS.joinToString { "'$it'" }}] as const;")

  println("export const WIND_LEVELS = [${WIND_LEVELS.joinToString()}] as const;")
  println("export const PEAK_WINDOWS = [${PEAK_WINDOWS.joinToString()}] as const;")
  println("export const ICING_LEVELS = [${ICING_LEVELS.joinToString()}] as const;")
  val turbulence = TURBULENCE_LAYERS.joinToString { (bottom, top) -> "[${bottom}, ${top}]" }
  println("export const TURBULENCE_LAYERS = [${turbulence}] as const;")

  for ((name, id) in listOf(
      "AIR_QUALITY_COLLECTION_ID" to AIR_QUALITY_COLLECTION_ID,
      "BURNT_AREAS_COLLECTION_ID" to BURNT_AREAS_COLLECTION_ID,
      "EUROPEAN_AIR_QUALITY_COLLECTION_ID" to EUROPEAN_AIR_QUALITY_COLLECTION_ID,
      "FIRE_PERIMETERS_COLLECTION_ID" to FIRE_PERIMETERS_COLLECTION_ID,
      "RIVER_GAUGES_COLLECTION_ID" to RIVER_GAUGES_COLLECTION_ID,
      "AIRSPACE_COLLECTION_ID" to AIRSPACE_COLLECTION_ID,
      "AIRPORTS_COLLECTION_ID" to AIRPORTS_COLLECTION_ID,
      "NAVAIDS_COLLECTION_ID" to NAVAIDS_COLLECTION_ID,
      "REPORTING_POINTS_COLLECTION_ID" to REPORTING_POINTS_COLLECTION_ID,
      "WEATHER_STATIONS_COLLECTION_ID" to WEATHER_STATIONS_COLLECTION_ID,
      "PROTECTED_AREAS_COLLECTION_ID" to PROTECTED_AREAS_COLLECTION_ID,
      "JAPANESE_NATIONAL_PARKS_COLLECTION_ID" to JAPANESE_NATIONAL_PARKS_COLLECTION_ID,
      "PUBLIC_LAND_COLLECTION_ID" to PUBLIC_LAND_COLLECTION_ID,
      "MOTOR_VEHICLE_USE_COLLECTION_ID" to MOTOR_VEHICLE_USE_COLLECTION_ID,
  )) {
    println("export const ${name} = '${id}';")
  }
}
