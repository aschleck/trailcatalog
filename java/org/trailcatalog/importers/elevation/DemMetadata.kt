package org.trailcatalog.importers.elevation

import com.google.common.geometry.S2LatLngRect
import java.nio.file.Path

data class DemMetadata(
    val id: String,
    val bounds: S2LatLngRect,
    val path: Path,
    val url: String,
    val global: Boolean,
)