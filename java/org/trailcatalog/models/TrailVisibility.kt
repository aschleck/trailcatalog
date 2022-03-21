package org.trailcatalog.models

enum class TrailVisibility(val id: Int) {
  UNKNOWN(0),
  VISIBLE(1),
  HIDDEN_AUTOMATICALLY(2),
  HIDDEN_MANUALLY(3),
}