package org.trailcatalog.importers.pbf

import com.google.common.reflect.TypeToken
import com.google.protobuf.CodedOutputStream
import org.trailcatalog.importers.pipeline.collections.Serializer
import org.trailcatalog.importers.pipeline.collections.registerSerializer
import org.trailcatalog.importers.pipeline.io.EncodedInputStream
import org.trailcatalog.importers.pipeline.io.EncodedOutputStream
import org.trailcatalog.proto.RelationSkeleton

fun registerPbfSerializers() {
  registerSerializer(TypeToken.of(LatLngE7::class.java), object : Serializer<LatLngE7> {

    override fun read(from: EncodedInputStream): LatLngE7 {
      val lat = from.readInt()
      val lng = from.readInt()
      return LatLngE7(lat, lng)
    }

    override fun size(v: LatLngE7): Int {
      return 8
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

    override fun size(v: Node): Int {
      return EncodedOutputStream.varLongSize(v.id) + 8
    }

    override fun write(v: Node, to: EncodedOutputStream) {
      to.writeVarLong(v.id)
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

    override fun size(v: Relation): Int {
      val nameBytes = v.name.encodeToByteArray().size
      val skeletonBytes = v.skeleton.serializedSize
      return EncodedOutputStream.varLongSize(v.id) +
          EncodedOutputStream.varIntSize(v.type) +
          EncodedOutputStream.varIntSize(nameBytes) +
          nameBytes +
          CodedOutputStream.computeUInt32SizeNoTag(skeletonBytes) +
          skeletonBytes
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
      val type = from.readVarInt()
      val nameLength = from.readVarInt()
      val nameBytes = ByteArray(nameLength)
      from.read(nameBytes)
      val pointsLength = from.readVarInt()
      val points = ArrayList<LatLngE7>(pointsLength)
      repeat(pointsLength) {
        points.add(LatLngE7(from.readInt(), from.readInt()))
      }
      return Way(id, type, nameBytes.decodeToString(), points)
    }

    override fun size(v: Way): Int {
      val nameBytes = v.name.encodeToByteArray().size
      return EncodedOutputStream.varLongSize(v.id) +
          EncodedOutputStream.varIntSize(v.type) +
          EncodedOutputStream.varIntSize(nameBytes) +
          nameBytes +
          EncodedOutputStream.varIntSize(v.points.size) +
          8 * v.points.size
    }

    override fun write(v: Way, to: EncodedOutputStream) {
      to.writeVarLong(v.id)
      to.writeVarInt(v.type)
      val bytes = v.name.encodeToByteArray()
      to.writeVarInt(bytes.size)
      to.write(bytes)
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

    override fun size(v: WaySkeleton): Int {
      val nameBytes = v.name.encodeToByteArray().size
      return EncodedOutputStream.varLongSize(v.id) +
          EncodedOutputStream.varIntSize(v.type) +
          EncodedOutputStream.varIntSize(nameBytes) +
          nameBytes +
          EncodedOutputStream.varIntSize(v.nodes.size) +
          v.nodes.map { EncodedOutputStream.varLongSize(it) }.sum()
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