package org.trailcatalog.pbf

import java.nio.charset.StandardCharsets

class WaysMembersCsvInputStream(chunk: List<List<IdPairRecord>>) : IteratedInputStream<List<IdPairRecord>>(
    chunk,
    "way_id,node_id\n".toByteArray(StandardCharsets.UTF_8),
) {

  override fun convertToCsv(value: List<IdPairRecord>, csv: StringBuilder) {
    for (pair in value) {
      csv.append(pair.a)
      csv.append(",")
      csv.append(pair.b)
      csv.append("\n")
    }
  }
}
