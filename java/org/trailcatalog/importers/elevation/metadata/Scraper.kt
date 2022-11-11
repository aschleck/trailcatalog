package org.trailcatalog.importers.elevation.metadata

import com.google.gson.Gson
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.trailcatalog.createConnectionSource
import org.trailcatalog.importers.common.ClosedIntRange
import org.trailcatalog.importers.common.fetch
import org.trailcatalog.s2.earthMetersToAngle
import java.sql.Timestamp
import java.time.Instant
import java.time.format.DateTimeFormatter

private data class BoundingBox(val minX: Double, val minY: Double, val maxX: Double, val maxY: Double) {
  fun xRange(): ClosedIntRange {
    return ClosedIntRange((minX * 10_000_000).toInt(), (maxX * 10_000_000).toInt())
  }

  fun yRange(): ClosedIntRange {
    return ClosedIntRange((minY * 10_000_000).toInt(), (maxY * 10_000_000).toInt())
  }
}

private data class Product(
    val title: String,
    val sourceId: String,
    // This is the date the entry was created, not imagery date. Alas.
    val dateCreated: String,
    val downloadURL: String,
    val boundingBox: BoundingBox,
)

private data class ProductsResponse(val total: Int, val items: List<Product>)

fun main(args: Array<String>) {
  val connections = createConnectionSource()
  val gson = Gson()
  connections.connection.use { connection ->
    val insertProduct =
        connection.prepareStatement(
            "INSERT INTO digital_elevation_models " +
                "(namespace, id, date, resolution_radians, lat_bound_degrees, lng_bound_degrees, url) " +
                "VALUES (?, ?, ?, ?, ?, ?, ?)"
        )
    for ((dataset, resolution) in mapOf(
        Pair("Digital%20Elevation%20Model%20(DEM)%201%20meter", earthMetersToAngle(1.0).radians()),
        Pair(
            "National%20Elevation%20Dataset%20(NED)%201/3%20arc-second",
            1.0 / 3 * Math.PI / (180 * 3600)),
        Pair(
            "National%20Elevation%20Dataset%20(NED)%201/9%20arc-second",
            1.0 / 9 * Math.PI / (180 * 3600)),
    )) {
      var offset = 0
      var remaining = 1
      val limit = 500
      while (remaining > 0) {
        fetch(metadataUrl(dataset, offset, limit)) { body, _ ->
          println("Fetched ${limit} from ${offset}")
          val response = gson.fromJson(body.string(), ProductsResponse::class.java)
          remaining = response.total - offset
          offset += limit

          for (product in response.items) {
            insertProduct.also {
              it.setString(1, "usgs")
              it.setString(2, product.sourceId)
              it.setTimestamp(
                  3,
                  Timestamp(
                      Instant.from(
                          DateTimeFormatter.ISO_INSTANT.parse(product.dateCreated)).toEpochMilli()))
              it.setDouble(4, resolution)
              it.setObject(5, product.boundingBox.yRange())
              it.setObject(6, product.boundingBox.xRange())
              it.setString(7, product.downloadURL)
            }.addBatch()
          }

          insertProduct.executeBatch()
        }
      }
    }
  }
}

private fun metadataUrl(dataset: String, offset: Int, limit: Int): HttpUrl {
  return ("https://tnmaccess.nationalmap.gov/api/v1/products?" +
      "datasets=${dataset}&prodFormats=GeoTIFF&offset=${offset}&max=${limit}").toHttpUrl()
}
