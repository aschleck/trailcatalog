package org.trailcatalog.importers.basemap

import java.io.File
import org.trailcatalog.importers.pbf.LatLngE7

data class Profile(
    val id: Long,
    val hash: Int,
    val down: Double,
    val up: Double,
    val length: Double,
    val profile: List<Float>,
)
