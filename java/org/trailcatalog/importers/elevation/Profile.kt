package org.trailcatalog.importers.elevation

import java.io.File

var ELEVATION_PROFILES_FILE = File("elevation_profiles.pb")

data class Profile(
    val id: Long,
    val version: Int,
    val down: Double,
    val up: Double,
    val profile: List<Float>,
)