package org.trailcatalog.models

// Node and way ids overlap, so a point's id carries which one it came from in its low bit.
fun nodePointId(nodeId: Long): Long = 2 * nodeId

fun wayPointId(wayId: Long): Long = 2 * wayId + 1

// Past every node and way point id, which are below 2^36 because OSM ids are below 2^35
const val RELATION_POINT_ID_OFFSET = 1L shl 40

fun relationPointId(relationId: Long): Long = RELATION_POINT_ID_OFFSET + relationId

// Node and way ids overlap relation ids, and a site drawn as a relation keeps the relation's id
// like every other boundary, so sites drawn as nodes or ways move into ranges that no OSM id
// reaches. OSM ids are below 2^35, and the offsets keep every id below 2^53 so that JavaScript
// numbers hold it exactly.
const val WAY_SITE_ID_OFFSET = 1L shl 40
const val NODE_SITE_ID_OFFSET = 2L shl 40

// A trail lists its paths with the low bit set on the ones it runs backward, so a path's own id
// leaves that bit clear.
fun pathId(wayId: Long): Long = 2 * wayId

fun getPathSourceWay(pathId: Long): Long = pathId shr 1
