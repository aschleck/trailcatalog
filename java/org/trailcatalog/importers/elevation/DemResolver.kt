package org.trailcatalog.importers.elevation

import com.google.common.cache.CacheBuilder
import com.google.common.cache.CacheLoader
import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2LatLngRect
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.slf4j.LoggerFactory
import org.trailcatalog.common.IORuntimeException
import org.trailcatalog.importers.common.NotFoundException
import org.trailcatalog.importers.common.download
import org.trailcatalog.importers.elevation.tiff.ConstantReader
import org.trailcatalog.importers.elevation.tiff.DemReader
import org.trailcatalog.importers.elevation.tiff.GeoTiffReader
import org.trailcatalog.s2.earthMetersToAngle

private val logger = LoggerFactory.getLogger(DemResolver::class.java)

class DemResolver {

  private var area = S2LatLngRect.empty()
  private val metadata = ArrayList<DemMetadata>()

  private val dems =
      CacheBuilder.newBuilder()
          .maximumSize(30)
          .removalListener<DemMetadata, DemReader> {
            it.value?.close()
          }
          .build(
              object : CacheLoader<DemMetadata, DemReader>() {
                override fun load(p0: DemMetadata): DemReader {
                  try {
                    download(p0.url.toHttpUrl(), p0.path)
                    return GeoTiffReader(p0.path)
                  } catch (e: NotFoundException) {
                    return ConstantReader(if (p0.global) 0f else null)
                  } catch (e: IORuntimeException) {
                    logger.warn("Error fetching ${p0.url}")
                    return ConstantReader(null)
                  }
                }
              })

  fun query(ll: S2LatLng): Float? {
    if (!area.contains(ll)) {
      // TODO(april): this is 10 miles, but is there a reason to pull 10 miles?
      area = S2LatLngRect.fromPoint(ll).expandedByDistance(earthMetersToAngle(16093.0))
      metadata.clear()
      metadata.addAll(getDemMetadata(area))
    }

    for (dem in metadata) {
      if (!dem.bounds.contains(ll)) {
        continue
      }

      val value = dems[dem].query(ll)
      if (value != null) {
        return value
      }
    }
    return null
  }
}
