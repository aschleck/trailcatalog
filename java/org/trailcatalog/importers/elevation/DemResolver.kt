package org.trailcatalog.importers.elevation

import com.google.common.geometry.S2LatLng
import org.trailcatalog.flags.FlagSpec
import org.trailcatalog.flags.createFlag
import org.trailcatalog.flags.createNullableFlag
import java.io.Closeable
import java.nio.file.Path

enum class ElevationSource {
  COPERNICUS,
  MAPTERHORN,
}

@FlagSpec("elevation_source")
private val elevationSource = createFlag(ElevationSource.MAPTERHORN)
@FlagSpec("copernicus_root")
private val copernicusRoot = createNullableFlag(null as Path?)
@FlagSpec("mapterhorn_pmtiles")
private val mapterhornPmtiles = createNullableFlag(null as Path?)

/** Samples elevations in meters above sea level. */
interface DemResolver : Closeable {

  override fun close() {}

  /** Returns the elevation at [ll], or null where the source has no data. */
  fun query(ll: S2LatLng): Float?
}

fun createDemResolver(): DemResolver {
  return when (elevationSource.value) {
    ElevationSource.COPERNICUS ->
      CopernicusResolver(checkNotNull(copernicusRoot.value) {
        "--copernicus_root is required with --elevation_source=COPERNICUS"
      })
    ElevationSource.MAPTERHORN ->
      MapterhornResolver(
          checkNotNull(mapterhornPmtiles.value) {
            "--mapterhorn_pmtiles is required with --elevation_source=MAPTERHORN"
          })
  }
}
