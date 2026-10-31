package org.trailcatalog.models

// A recording drifts 3 or 4 m in altitude over a flat day and Copernicus quotes up to 4 m of
// relative error on steep slopes, so reversals smaller than this are noise. Real climbs lose
// nothing because only the reversal is dropped, never the climb on either side of it.
const val CLIMB_THRESHOLD_METERS = 5.0

// On Four Mile Trail and Upper Yosemite Fall, z14 gives the same climb as z16 once reversals under
// CLIMB_THRESHOLD_METERS are dropped, and z13 through z14 of every regional mapterhorn archive is
// 755 GB against 9.6 TB for all of it.
const val ELEVATION_MAX_ZOOM = 14
