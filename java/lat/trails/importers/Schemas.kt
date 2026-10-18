package lat.trails.importers

// Builders for the JSON in collections.schema, see schema.ts#CollectionSchema

val ALWAYS = mapOf("match" to "always")

fun stringEquals(key: String, value: String) =
    mapOf("match" to "string_equals", "key" to key, "value" to value)

// Each field goes on every kind the layers draw, since a field belongs to one kind.
fun schema(fields: List<Map<String, Any>>, layers: List<Map<String, Any>>): Map<String, Any> {
  val kinds = layers.map { it["kind"]!! }.distinct()
  return mapOf(
      "fields" to kinds.flatMap { kind -> fields.map { it + ("kind" to kind) } },
      "layers" to layers,
  )
}

// A field shown in the properties dialog. One with display names for its raw values is a select.
fun field(id: String, label: String, values: Map<String, String>? = null) =
    if (values == null) {
      mapOf("id" to id, "label" to label, "type" to "text")
    } else {
      mapOf(
          "id" to id,
          "label" to label,
          "type" to "select",
          "options" to values.map { (value, name) -> mapOf("id" to value, "label" to name) },
      )
    }

fun polygonLayer(filters: List<Map<String, Any>>, fill: String) =
    mapOf(
        "kind" to "polygon",
        "filters" to filters,
        "fill" to constant(fill),
        "stroke" to constant(NO_STROKE),
        "label" to NAME_LABEL,
    )

fun pointLayer(filters: List<Map<String, Any>>, fill: String) =
    mapOf(
        "kind" to "point",
        "filters" to filters,
        "fill" to constant(fill),
        "icon" to constant("⬤"),
        "radius" to constant(4),
        "label" to NAME_LABEL,
    )

// Imported polygons are fills, and a clear stroke draws no outline.
private const val NO_STROKE = "#00000000"

private val NAME_LABEL = mapOf("kind" to "field", "key" to "name")

private fun constant(value: Any) = mapOf("kind" to "constant", "value" to value)
