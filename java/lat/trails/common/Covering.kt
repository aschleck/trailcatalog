package lat.trails.common

import com.google.common.geometry.S2CellId
import java.io.ByteArrayOutputStream
import java.util.Comparator
import org.trailcatalog.common.DelegatingEncodedOutputStream

/**
 * Generates a covering from a list of S2CellIds.
 */
fun encodeCovering(cells: Collection<S2CellId>): ByteArray {
  val reduced = HashSet<S2CellId>()
  for (cell in cells) {
    reduced.add(cell.parent(COLLECTION_COVERING_MAX_LEVEL.coerceAtMost(cell.level())))
  }

  val sorted = ArrayList(reduced)
  sorted.sortWith(Comparator.naturalOrder())
  return ByteArrayOutputStream().also {
    DelegatingEncodedOutputStream(it).use {
      // version
      it.writeVarInt(1)
      it.writeVarInt(sorted.size)
      for (cell in sorted) {
        it.writeLong(cell.id())
      }
    }
  }.toByteArray()
}
