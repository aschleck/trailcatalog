package org.trailcatalog.importers.elevation.contour

import com.google.common.geometry.S2CellId
import com.google.common.geometry.S2CellUnion
import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2LatLngRect
import com.google.common.geometry.S2Loop
import com.google.common.geometry.S2Point
import com.google.common.geometry.S2Polygon
import com.google.common.geometry.S2PolygonBuilder
import com.google.common.geometry.S2RegionCoverer
import com.google.gson.stream.JsonReader
import org.trailcatalog.importers.common.ProgressBar
import java.nio.file.Path

class Glaciator(path: Path) {

  private var bounded: ArrayList<Pair<S2LatLngRect, S2Polygon>>
  private val inner: S2CellUnion
  private val outer: S2CellUnion

  init {
    val glaciers = loadOverpassGlaciers(path)
    println("${glaciers.size} glaciers found")
    val coverer =
        S2RegionCoverer.builder()
            .setMaxCells(100)
            .setMaxLevel(20)
            .build()
    val inners = HashSet<S2CellId>()
    val outers = HashSet<S2CellId>()
    bounded = ArrayList()
    ProgressBar("Generating coverings", "glaciers", glaciers.size).use {
      for (glacier in glaciers) {
        bounded.add(Pair(glacier.rectBound, glacier))
        inners.addAll(coverer.getInteriorCovering(glacier).cellIds())
        outers.addAll(coverer.getCovering(glacier).cellIds())
        it.increment()
      }
    }
    inner = S2CellUnion().also {
      it.initRawSwap(inners.toMutableList())
    }
    outer = S2CellUnion().also {
      it.initRawSwap(outers.toMutableList())
    }
  }

  fun glaciate(contours: List<Contour>): List<Contour> {
    val out = ArrayList<Contour>()
    for (original in contours) {
      val points = original.points.map { it.toPoint() }
      var start = 0
      var on = onGlacier(points[start])
      for (i in points.indices.drop(1)) {
        val now = onGlacier(points[i])
        if (on != now) {
          out.add(Contour(original.height, on, original.points.subList(start, i + 1)))
        }

        start = i
        on = now
      }
    }
    return out
  }

  private fun onGlacier(point: S2Point): Boolean {
    if (!outer.contains(point)) {
      return false
    } else if (inner.contains(point)) {
      return true
    } else {
      for ((bound, polygon) in bounded) {
        if (bound.contains(point) && polygon.contains(point)) {
          return true
        }
      }
      return false
    }
  }
}

private fun loadOverpassGlaciers(path: Path): List<S2Polygon> {
  JsonReader(path.toFile().inputStream().bufferedReader()).use {
    it.beginObject()
    while (it.hasNext()) {
      val name = it.nextName()
      when (name) {
        "elements" -> return loadGlacierElements(it)
        else -> it.skipValue()
      }
    }

    throw IllegalStateException("Didn't find elements")
  }
}

private fun loadGlacierElements(reader: JsonReader): List<S2Polygon> {
  reader.beginArray()
  val polygons = ArrayList<S2Polygon>()
  val knownGlaciers = HashSet<Long>()
  while (reader.hasNext()) {
    polygons.addAll(loadElement(reader, knownGlaciers))
  }
  reader.endArray()
  return polygons
}

private fun loadElement(reader: JsonReader, knownGlaciers: HashSet<Long>): List<S2Polygon> {
  reader.beginObject()

  if (reader.nextName() != "type") {
    throw IllegalStateException("Expected type first")
  }

  val polygons = when (reader.nextString()) {
    "node" -> {
      while (reader.hasNext()) {
        reader.nextName()
        reader.skipValue()
      }
      listOf()
    }
    "way" -> {
      var polygon: S2Polygon? = null
      while (reader.hasNext()) {
        when (reader.nextName()) {
          "geometry" -> {
            val points = loadGeometry(reader)
            if (points[0] == points[points.size - 1]) {
              val loop = S2Loop(points)
              loop.normalize()
              polygon = S2Polygon(arrayListOf(loop))
            }
          }
          "id" -> knownGlaciers.add(reader.nextLong())
          else -> reader.skipValue()
        }
      }
      if (polygon != null) {
        if (polygon.rectBound.isEmpty || polygon.rectBound.isFull) {
          reader.beginArray()
          throw IllegalArgumentException("Bad polygon")
        }
        listOf(polygon)
      } else {
        listOf()
      }
    }
    "relation" -> {
      var polygon: S2Polygon? = null
      while (reader.hasNext()) {
        when (reader.nextName()) {
          "members" -> polygon = loadRelationMembers(reader, knownGlaciers)
          "id" -> knownGlaciers.add(reader.nextLong())
          else -> reader.skipValue()
        }
      }
      if (polygon != null) listOf(polygon) else listOf()
    }
    else -> throw IllegalArgumentException("Unknown type of object")
  }

  reader.endObject()
  return polygons
}

private fun loadRelationMembers(reader: JsonReader, knownGlaciers: HashSet<Long>): S2Polygon {
  val outers = S2PolygonBuilder(S2PolygonBuilder.Options.UNDIRECTED_UNION)
  val inners = S2PolygonBuilder(S2PolygonBuilder.Options.UNDIRECTED_UNION)

  reader.beginArray()
  while (reader.hasNext()) {
    reader.beginObject()

    if (reader.nextName() != "type") {
      throw IllegalStateException("Expected type first")
    }

    when (reader.nextString()) {
      "node" -> {
        while (reader.hasNext()) {
          reader.nextName()
          reader.skipValue()
        }
      }
      "way" -> {
        var inner = false
        val points = ArrayList<S2Point>()
        while (reader.hasNext()) {
          when (reader.nextName()) {
            "role" -> {
              inner = reader.nextString().lowercase() == "inner"
            }
            "geometry" -> {
              points.addAll(loadGeometry(reader))
            }
            else -> reader.skipValue()
          }
        }

        val target = if (inner) inners else outers
        for (i in 0 until points.size - 1) {
          target.addEdge(points[i], points[i + 1])
        }
      }
      "relation" -> {
        var known = false
        while (reader.hasNext()) {
          when (reader.nextName()) {
            "ref" -> known = knownGlaciers.contains(reader.nextLong())
            else -> reader.skipValue()
          }
        }

        // If it's already known, we can just skip it since we will glaciate using it elsewhere.
        if (!known) {
          reader.beginArray()
          throw IllegalArgumentException("Unhandled")
        }
      }
      else -> throw IllegalArgumentException("Unknown type of object")
    }

    reader.endObject()
  }
  reader.endArray()

  val polygon = S2Polygon()
  polygon.initToDifference(outers.assemblePolygon(), inners.assemblePolygon())

  if (polygon.rectBound.isEmpty || polygon.rectBound.isFull) {
    reader.beginArray()
    throw IllegalArgumentException("Bad polygon")
  }
  return polygon
}

private fun loadGeometry(reader: JsonReader): List<S2Point> {
  reader.beginArray()
  val points = ArrayList<S2Point>()
  while (reader.hasNext()) {
    reader.beginObject()
    if (reader.nextName() != "lat") {
      throw IllegalArgumentException("Expected lat first")
    }
    val lat = reader.nextDouble()
    if (reader.nextName() != "lon") {
      throw IllegalArgumentException("Expected lon second")
    }
    val lng = reader.nextDouble()
    points.add(S2LatLng.fromDegrees(lat, lng).toPoint())
    reader.endObject()
  }
  reader.endArray()
  return points
}
