package org.trailcatalog.importers.basemap

import java.io.File
import org.trailcatalog.importers.pbf.LatLngE7

var ELEVATION_PROFILES_FILE = File("elevation_profiles.pb")

data class Profile(
    val id: Long,
    val hash: Int,
    val down: Double,
    val up: Double,
    val profile: List<Float>,
)
