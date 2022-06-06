package org.trailcatalog.importers

import okhttp3.HttpUrl.Companion.toHttpUrl
import org.trailcatalog.createConnectionSource
import org.trailcatalog.importers.pipeline.groupBy
import org.trailcatalog.importers.pipeline.PSink
import org.trailcatalog.importers.pipeline.Pipeline
import org.trailcatalog.importers.pipeline.collections.PMap
import org.trailcatalog.importers.pbf.ExtractNodeWayPairs
import org.trailcatalog.importers.pbf.ExtractNodes
import org.trailcatalog.importers.pbf.ExtractRelationGeometriesWithWays
import org.trailcatalog.importers.pbf.ExtractRelations
import org.trailcatalog.importers.pbf.ExtractWays
import org.trailcatalog.importers.pbf.GatherWayNodes
import org.trailcatalog.importers.pbf.ExtractWayRelationPairs
import org.trailcatalog.importers.pbf.GatherRelationWays
import org.trailcatalog.importers.pbf.MakeRelationGeometries
import org.trailcatalog.importers.pbf.MakeWayGeometries
import org.trailcatalog.importers.pbf.PbfBlockReader
import org.trailcatalog.importers.pbf.registerPbfSerializers
import org.trailcatalog.proto.RelationGeometry
import java.nio.file.Path
import java.sql.Connection

fun main(args: Array<String>) {
  registerPbfSerializers()

  createConnectionSource(syncCommit = false).use { hikari ->
    hikari.getConnection().use { connection ->
      processPbfs(fetchSources(connection))
    }
  }
}

fun fetchSources(connection: Connection): List<Path> {
  val sources = ArrayList<String>()
  connection.prepareStatement("SELECT path FROM geofabrik_sources").executeQuery().use {
    while (it.next()) {
      sources.add(it.getString(1))
    }
  }

  val paths = ArrayList<Path>()
  for (source in sources) {
    val pbfUrl = "https://download.geofabrik.de/${source}-latest.osm.pbf".toHttpUrl()
    val pbf = Path.of("pbfs", pbfUrl.pathSegments[pbfUrl.pathSize - 1])
    download(pbfUrl, pbf)
    paths.add(pbf)
  }
  return paths
}

fun processPbfs(pbfs: List<Path>) {
  val pipeline = Pipeline()
  val nodes =
      pipeline.cat(
          pbfs.map { p ->
            pipeline
                .read(PbfBlockReader(p))
                .then(ExtractNodes())
          })
      .groupBy { it.id }
  val ways =
      pipeline.cat(
          pbfs.map { p ->
            pipeline
                .read(PbfBlockReader(p))
                .then(ExtractWays())
          })
      .groupBy { it.id }
  val waysToPoints =
      pipeline
          .join2(nodes, ways.then(ExtractNodeWayPairs()))
          .then(GatherWayNodes())
  val waysWithGeometry = pipeline.join2(ways, waysToPoints).then(MakeWayGeometries())
  val relations =
      pipeline.cat(
          pbfs.map { p ->
            pipeline
                .read(PbfBlockReader(p))
                .then(ExtractRelations())
          })
          .groupBy { it.id }
  val relationsToGeometriesWithWays = relations.then(ExtractRelationGeometriesWithWays())
  val relationsToWayGeometries =
      pipeline
          .join2(relationsToGeometriesWithWays.then(ExtractWayRelationPairs()), waysWithGeometry)
          .then(GatherRelationWays())
  val relationsWithGeometry =
      pipeline
          .join2(relationsToGeometriesWithWays, relationsToWayGeometries)
          .then(MakeRelationGeometries())
          .write(Dump())

  pipeline.execute()
}

class Dump : PSink<PMap<Long, RelationGeometry>>() {

  override fun write(input: PMap<Long, RelationGeometry>) {
    while (input.hasNext()) {
      input.next().apply {
        println("${key}: ${values.size} size ${values.sumOf { it.serializedSize }}")
      }
    }
  }
}
