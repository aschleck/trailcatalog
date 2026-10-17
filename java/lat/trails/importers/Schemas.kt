package lat.trails.importers

// Builders for the JSON in collections.schema, see schema.ts#CollectionSchema

val ALWAYS = mapOf("match" to "always")

fun stringEquals(key: String, value: String) =
    mapOf("match" to "string_equals", "key" to key, "value" to value)

fun schema(fields: List<Map<String, Any>>, layers: List<Map<String, Any>>) =
    mapOf("fields" to fields, "layers" to layers)

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

private val NAME_LABEL = mapOf("kind" to "field", "key" to "name")

private fun constant(value: Any) = mapOf("kind" to "constant", "value" to value)
