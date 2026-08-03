package org.trailcatalog.importers.elevation

import com.google.common.truth.Truth.assertThat
import org.junit.Test
import org.trailcatalog.importers.elevation.pmtiles.PmtilesReader
import org.trailcatalog.importers.elevation.pmtiles.zxyToTileId
import kotlin.io.path.createTempFile

class PmtilesReaderTest {

  // Ids from the reference implementation at
  // https://github.com/protomaps/PMTiles/blob/main/js/src/index.ts
  @Test
  fun testTileIdsFollowTheHilbertCurve() {
    assertThat(zxyToTileId(0, 0, 0)).isEqualTo(0L)
    assertThat(zxyToTileId(1, 0, 0)).isEqualTo(1L)
    assertThat(zxyToTileId(1, 0, 1)).isEqualTo(2L)
    assertThat(zxyToTileId(1, 1, 1)).isEqualTo(3L)
    assertThat(zxyToTileId(1, 1, 0)).isEqualTo(4L)
    assertThat(zxyToTileId(2, 0, 0)).isEqualTo(5L)
    assertThat(zxyToTileId(2, 1, 2)).isEqualTo(12L)
    assertThat(zxyToTileId(12, 662, 1443)).isEqualTo(9231630L)
    assertThat(zxyToTileId(12, 718, 1604)).isEqualTo(8926747L)
  }

  @Test
  fun testQueryFollowsLeafDirectories() {
    val path =
        Archive(maxZoom = 12)
            .put(12, 662, 1443, "rainier".toByteArray())
            .put(12, 718, 1604, "badwater".toByteArray())
            .put(3, 1, 2, "small".toByteArray())
            .write(createTempFile(suffix = ".pmtiles"), inLeaves = true)

    PmtilesReader(path).use {
      assertThat(it.query(12, 662, 1443)).isEqualTo("rainier".toByteArray())
      assertThat(it.query(12, 718, 1604)).isEqualTo("badwater".toByteArray())
      assertThat(it.query(3, 1, 2)).isEqualTo("small".toByteArray())
    }
  }

  @Test
  fun testQueryReadsRootOnlyArchives() {
    val path =
        Archive(maxZoom = 12)
            .put(12, 662, 1443, "rainier".toByteArray())
            .put(12, 718, 1604, "badwater".toByteArray())
            .write(createTempFile(suffix = ".pmtiles"), inLeaves = false)

    PmtilesReader(path).use {
      assertThat(it.query(12, 662, 1443)).isEqualTo("rainier".toByteArray())
      assertThat(it.query(12, 718, 1604)).isEqualTo("badwater".toByteArray())
    }
  }

  @Test
  fun testQueryReadsOffsetsThatWereWrittenOut() {
    val path =
        Archive(maxZoom = 12)
            .put(12, 662, 1443, "rainier".toByteArray())
            .put(12, 718, 1604, "badwater".toByteArray())
            .write(createTempFile(suffix = ".pmtiles"), elideOffsets = false)

    PmtilesReader(path).use {
      assertThat(it.query(12, 662, 1443)).isEqualTo("rainier".toByteArray())
      assertThat(it.query(12, 718, 1604)).isEqualTo("badwater".toByteArray())
    }
  }

  @Test
  fun testQueryReturnsNullForTilesTheArchiveSkips() {
    val path =
        Archive(maxZoom = 12)
            .put(12, 662, 1443, "rainier".toByteArray())
            .write(createTempFile(suffix = ".pmtiles"))

    PmtilesReader(path).use {
      // Before, after, and between the ids the archive holds
      assertThat(it.query(0, 0, 0)).isNull()
      assertThat(it.query(12, 663, 1443)).isNull()
      assertThat(it.query(12, 718, 1604)).isNull()
    }
  }

  @Test
  fun testHeaderReportsWhatTheArchiveHolds() {
    val path =
        Archive(maxZoom = 9)
            .put(9, 82, 180, "tile".toByteArray())
            .write(createTempFile(suffix = ".pmtiles"))

    PmtilesReader(path).use {
      assertThat(it.minZoom).isEqualTo(0)
      assertThat(it.maxZoom).isEqualTo(9)
    }
  }
}
