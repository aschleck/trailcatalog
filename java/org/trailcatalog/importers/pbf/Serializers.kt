package org.trailcatalog.importers.pbf

import com.google.common.reflect.TypeToken
import com.google.protobuf.CodedInputStream
import com.google.protobuf.CodedOutputStream
import org.trailcatalog.importers.pipeline.collections.Serializer
import org.trailcatalog.importers.pipeline.collections.registerSerializer
import org.trailcatalog.proto.RelationSkeleton
import java.nio.ByteBuffer

public fun registerPbfSerializers() {
  registerSerializer(TypeToken.of(LatLngE7::class.java), object : Serializer<LatLngE7> {

    override fun read(from: ByteBuffer): LatLngE7 {
      val ints = from.asIntBuffer()
      val lat = ints.get()
      val lng = ints.get()
      from.position(from.position() + 8)
      return LatLngE7(lat, lng)
    }

    override fun write(v: LatLngE7, to: ByteBuffer) {
      to.asIntBuffer().put(v.lat).put(v.lng)
      to.position(to.position() + 8)
    }
  })

  registerSerializer(TypeToken.of(Node::class.java), object : Serializer<Node> {

    override fun read(from: ByteBuffer): Node {
      val id = from.asLongBuffer().get()
      from.position(from.position() + 8)
      val ints = from.asIntBuffer()
      val lat = ints.get()
      val lng = ints.get()
      from.position(from.position() + 8)
      return Node(id, LatLngE7(lat, lng))
    }

    override fun write(v: Node, to: ByteBuffer) {
      to.asLongBuffer().put(v.id)
      to.position(to.position() + 8)
      to.asIntBuffer().put(v.latLng.lat).put(v.latLng.lng)
      to.position(to.position() + 8)
    }
  })

  registerSerializer(TypeToken.of(Relation::class.java), object : Serializer<Relation> {

    override fun read(from: ByteBuffer): Relation {
      val id = from.asLongBuffer().get()
      from.position(from.position() + 8)
      val type = from.asIntBuffer().get()
      from.position(from.position() + 4)
      val nameLength = from.asShortBuffer().get()
      from.position(from.position() + 2)
      val nameBytes = ByteArray(nameLength.toInt())
      from.get(nameBytes)

      val coded = CodedInputStream.newInstance(from)
      val skeletonBytes = ByteArray(coded.readUInt32())
      from.position(from.position() + coded.totalBytesRead)
      from.get(skeletonBytes)
      val skeleton = RelationSkeleton.parseFrom(skeletonBytes)

      return Relation(id, type, nameBytes.decodeToString(), skeleton)
    }

    override fun write(v: Relation, to: ByteBuffer) {
      to.asLongBuffer().put(v.id)
      to.position(to.position() + 8)
      to.asIntBuffer().put(v.type)
      to.position(to.position() + 4)
      val bytes = v.name.encodeToByteArray()
      to.asShortBuffer().put(bytes.size.toShort())
      to.position(to.position() + 2)
      to.put(bytes)

      val coded = CodedOutputStream.newInstance(to)
      coded.writeUInt32NoTag(v.skeleton.serializedSize)
      coded.flush()
      to.put(v.skeleton().toByteArray())
    }
  })

  registerSerializer(TypeToken.of(Way::class.java), object : Serializer<Way> {

    override fun read(from: ByteBuffer): Way {
      val id = from.asLongBuffer().get()
      from.position(from.position() + 8)
      val type = from.asIntBuffer().get()
      from.position(from.position() + 4)
      val nameLength = from.asShortBuffer().get()
      from.position(from.position() + 2)
      val nameBytes = ByteArray(nameLength.toInt())
      from.get(nameBytes)
      val nodesLength = from.asShortBuffer().get()
      from.position(from.position() + 2)
      val nodes = LongArray(nodesLength.toInt())
      from.asLongBuffer().get(nodes)
      from.position(from.position() + 8 * nodesLength)
      return Way(id, type, nameBytes.decodeToString(), nodes)
    }

    override fun write(v: Way, to: ByteBuffer) {
      to.asLongBuffer().put(v.id)
      to.position(to.position() + 8)
      to.asIntBuffer().put(v.type)
      to.position(to.position() + 4)
      val bytes = v.name.encodeToByteArray()
      to.asShortBuffer().put(bytes.size.toShort())
      to.position(to.position() + 2)
      to.put(bytes)
      to.asShortBuffer().put(v.nodes.size.toShort())
      to.position(to.position() + 2)
      to.asLongBuffer().put(v.nodes)
      to.position(to.position() + 8 * v.nodes.size)
    }
  })
}