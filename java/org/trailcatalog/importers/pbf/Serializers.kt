package org.trailcatalog.importers.pbf

import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pipeline.collections.Serializer
import org.trailcatalog.importers.pipeline.collections.registerSerializer
import org.trailcatalog.importers.pipeline.io.EncodedInputStream
import org.trailcatalog.common.EncodedOutputStream
import org.trailcatalog.proto.RelationSkeleton

fun registerPbfSerializers() {
  registerSerializer(TypeToken.of(LatLngE7::class.java), object : Serializer<LatLngE7> {

    override fun read(from: EncodedInputStream): LatLngE7 {
      val lat = from.readInt()
      val lng = from.readInt()
      return LatLngE7(lat, lng)
    }

    override fun write(v: LatLngE7, to: EncodedOutputStream) {
      to.writeInt(v.lat)
      to.writeInt(v.lng)
    }
  })

  registerSerializer(TypeToken.of(Node::class.java), object : Serializer<Node> {

    override fun read(from: EncodedInputStream): Node {
      val id = from.readVarLong()
      val lat = from.readInt()
      val lng = from.readInt()
      return Node(id, LatLngE7(lat, lng))
    }

    override fun write(v: Node, to: EncodedOutputStream) {
      to.writeVarLong(v.id)
      to.writeInt(v.latLng.lat)
      to.writeInt(v.latLng.lng)
    }
  })

  registerSerializer(TypeToken.of(Point::class.java), object : Serializer<Point> {

    override fun read(from: EncodedInputStream): Point {
      val id = from.readVarLong()
      val type = from.readVarInt()
      val name = ByteArray(from.readVarInt()).also {
        from.read(it)
      }.decodeToString()
      val lat = from.readInt()
      val lng = from.readInt()
      return Point(id, type, if (name.length == 0) null else name, LatLngE7(lat, lng))
    }

    override fun write(v: Point, to: EncodedOutputStream) {
      to.writeVarLong(v.id)
      to.writeVarInt(v.type)
      (v.name ?: "").encodeToByteArray().let {
        to.writeVarInt(it.size)
        to.write(it)
      }
      to.writeInt(v.latLng.lat)
      to.writeInt(v.latLng.lng)
    }
  })

  registerSerializer(TypeToken.of(Relation::class.java), object : Serializer<Relation> {

    override fun read(from: EncodedInputStream): Relation {
      val id = from.readVarLong()
      val type = from.readVarInt()
      val nameLength = from.readVarInt()
      val nameBytes = ByteArray(nameLength)
      from.read(nameBytes)
      val skeleton = RelationSkeleton.parseDelimitedFrom(from)
      return Relation(id, type, nameBytes.decodeToString(), skeleton)
    }

    override fun write(v: Relation, to: EncodedOutputStream) {
      to.writeVarLong(v.id)
      to.writeVarInt(v.type)
      val bytes = v.name.encodeToByteArray()
      to.writeVarInt(bytes.size)
      to.write(bytes)
      v.skeleton.writeDelimitedTo(to)
    }
  })

  registerSerializer(TypeToken.of(Way::class.java), object : Serializer<Way> {

    override fun read(from: EncodedInputStream): Way {
      val id = from.readVarLong()
      val hash = from.readInt()
      val type = from.readVarInt()
      val down = from.readFloat()
      val up = from.readFloat()
      val pointsLength = from.readVarInt()
      val points = ArrayList<LatLngE7>(pointsLength)
      repeat(pointsLength) {
        points.add(LatLngE7(from.readInt(), from.readInt()))
      }
      return Way(id, hash, type, down, up, points)
    }

    override fun write(v: Way, to: EncodedOutputStream) {
      to.writeVarLong(v.id)
      to.writeInt(v.hash)
      to.writeVarInt(v.type)
      to.writeFloat(v.downMeters)
      to.writeFloat(v.upMeters)
      to.writeVarInt(v.points.size)
      v.points.forEach {
        to.writeInt(it.lat)
        to.writeInt(it.lng)
      }
    }
  })

  registerSerializer(TypeToken.of(WaySkeleton::class.java), object : Serializer<WaySkeleton> {

    override fun read(from: EncodedInputStream): WaySkeleton {
      val id = from.readVarLong()
      val type = from.readVarInt()
      val nameLength = from.readVarInt()
      val nameBytes = ByteArray(nameLength)
      from.read(nameBytes)
      val nodesLength = from.readVarInt()
      val nodes = LongArray(nodesLength)
      (0 until nodesLength).forEach { nodes[it] = from.readVarLong() }
      return WaySkeleton(id, type, nameBytes.decodeToString(), nodes)
    }

    override fun write(v: WaySkeleton, to: EncodedOutputStream) {
      to.writeVarLong(v.id)
      to.writeVarInt(v.type)
      val bytes = v.name.encodeToByteArray()
      to.writeVarInt(bytes.size)
      to.write(bytes)
      to.writeVarInt(v.nodes.size)
      v.nodes.forEach { to.writeVarLong(it) }
    }
  })
}
