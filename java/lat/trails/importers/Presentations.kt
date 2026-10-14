package lat.trails.importers

// Builders for the JSON in collections.presentation, see collection_layer.ts#Presentation

val ALWAYS = mapOf("match" to "always")

fun stringEquals(key: String, value: String) =
    mapOf("match" to "string_equals", "key" to key, "value" to value)

// A field's label in the properties dialog, and optionally display names for its raw values
fun field(key: String, label: String, values: Map<String, String>? = null) =
    if (values == null) mapOf("key" to key, "label" to label)
    else mapOf("key" to key, "label" to label, "values" to values)
