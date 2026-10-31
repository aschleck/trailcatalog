package org.trailcatalog.models

// Keep in sync with the source_type comment in trailcatalog/migrations/4_source_tags.toml.
enum class SourceType(val id: Int) {
  NODE(0),
  WAY(1),
  RELATION(2),
}
