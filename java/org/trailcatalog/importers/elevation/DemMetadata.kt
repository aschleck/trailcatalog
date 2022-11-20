package org.trailcatalog.importers.elevation

import com.google.common.geometry.S2LatLngRect

data class DemMetadata(
    val id: String,
    val bounds: S2LatLngRect,
    val url: String,
    val global: Boolean,
)