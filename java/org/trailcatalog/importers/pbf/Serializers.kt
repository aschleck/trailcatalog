package org.trailcatalog.importers.pbf

import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pipeline.collections.Serializer
import org.trailcatalog.importers.pipeline.collections.getSerializer
import org.trailcatalog.importers.pipeline.collections.registerSerializer
import org.trailcatalog.common.EncodedInputStream
import org.trailcatalog.common.EncodedOutputStream
import org.trailcatalog.proto.RelationSkeleton

fun readNames(from: EncodedInputStream): List<Name> {
  val count = from.readVarInt()
  val names = ArrayList<Name>(count)
  repeat(count) {
    val language = if (from.readBoolean()) readString(from) else null
    names.add(Name(language, readString(from)))
  }
  return names
}

fun writeNames(names: List<Name>, to: EncodedOutputStream) {
  to.writeVarInt(names.size)
  for (name in names) {
    val language = name.language
    to.writeBoolean(language != null)
    if (language != null) {
      writeString(language, to)
    }
    writeString(name.value, to)
  }
}

private fun <T : Any> writeOptional(v: T?, serializer: Serializer<T>, to: EncodedOutputStream) {
  to.writeBoolean(v != null)
  if (v != null) {
    serializer.write(v, to)
  }
}

private fun readString(from: EncodedInputStream): String {
  return ByteArray(from.readVarInt()).also { from.read(it) }.decodeToString()
}

private fun writeString(value: String, to: EncodedOutputStream) {
  val bytes = value.encodeToByteArray()
  to.writeVarInt(bytes.size)
  to.write(bytes)
}

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
      val names = readNames(from)
      val notable = from.readBoolean()
      val lat = from.readInt()
      val lng = from.readInt()
      return Point(
          id, type, if (name.length == 0) null else name, names, notable, LatLngE7(lat, lng))
    }

    override fun write(v: Point, to: EncodedOutputStream) {
      to.writeVarLong(v.id)
      to.writeVarInt(v.type)
      (v.name ?: "").encodeToByteArray().let {
        to.writeVarInt(it.size)
        to.write(it)
      }
      writeNames(v.names, to)
      to.writeBoolean(v.notable)
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
      val names = readNames(from)
      val skeleton = RelationSkeleton.parseDelimitedFrom(from)
      return Relation(id, type, nameBytes.decodeToString(), names, skeleton)
    }

    override fun write(v: Relation, to: EncodedOutputStream) {
      to.writeVarLong(v.id)
      to.writeVarInt(v.type)
      val bytes = v.name.encodeToByteArray()
      to.writeVarInt(bytes.size)
      to.write(bytes)
      writeNames(v.names, to)
      v.skeleton.writeDelimitedTo(to)
    }
  })

  registerSerializer(
      TypeToken.of(ClimbingElement::class.java), object : Serializer<ClimbingElement> {

    override fun read(from: EncodedInputStream): ClimbingElement {
      val id = from.readVarLong()
      val type = from.readVarInt()
      val name = readString(from)
      val names = readNames(from)
      val latLng = if (from.readBoolean()) LatLngE7(from.readInt(), from.readInt()) else null
      val members = RelationSkeleton.parseDelimitedFrom(from)
      return ClimbingElement(id, type, name, names, latLng, members)
    }

    override fun write(v: ClimbingElement, to: EncodedOutputStream) {
      to.writeVarLong(v.id)
      to.writeVarInt(v.type)
      writeString(v.name, to)
      writeNames(v.names, to)
      val latLng = v.latLng
      to.writeBoolean(latLng != null)
      if (latLng != null) {
        to.writeInt(latLng.lat)
        to.writeInt(latLng.lng)
      }
      v.members.writeDelimitedTo(to)
    }
  })

  registerSerializer(TypeToken.of(SourceTags::class.java), object : Serializer<SourceTags> {

    override fun read(from: EncodedInputStream): SourceTags {
      val type = SourceType.entries[from.readVarInt()]
      val id = from.readVarLong()
      val version = if (from.readBoolean()) from.readVarInt() else null
      return SourceTags(type, id, version, readString(from))
    }

    override fun write(v: SourceTags, to: EncodedOutputStream) {
      to.writeVarInt(v.type.ordinal)
      to.writeVarLong(v.id)
      val version = v.version
      to.writeBoolean(version != null)
      if (version != null) {
        to.writeVarInt(version)
      }
      writeString(v.tagsJson, to)
    }
  })

  registerSerializer(TypeToken.of(SmallElement::class.java), object : Serializer<SmallElement> {

    private val tags by lazy { getSerializer(TypeToken.of(SourceTags::class.java)) }
    private val point by lazy { getSerializer(TypeToken.of(Point::class.java)) }
    private val relation by lazy { getSerializer(TypeToken.of(Relation::class.java)) }
    private val climbing by lazy { getSerializer(TypeToken.of(ClimbingElement::class.java)) }

    override fun read(from: EncodedInputStream): SmallElement {
      return SmallElement(
          if (from.readBoolean()) tags.read(from) else null,
          if (from.readBoolean()) point.read(from) else null,
          if (from.readBoolean()) relation.read(from) else null,
          if (from.readBoolean()) climbing.read(from) else null)
    }

    override fun write(v: SmallElement, to: EncodedOutputStream) {
      writeOptional(v.tags, tags, to)
      writeOptional(v.point, point, to)
      writeOptional(v.relation, relation, to)
      writeOptional(v.climbing, climbing, to)
    }
  })

  registerSerializer(TypeToken.of(Way::class.java), object : Serializer<Way> {

    override fun read(from: EncodedInputStream): Way {
      val id = from.readVarLong()
      val hash = from.readInt()
      val type = from.readVarInt()
      val down = from.readFloat()
      val up = from.readFloat()
      val length = from.readFloat()
      val pointsLength = from.readVarInt()
      val points = ArrayList<LatLngE7>(pointsLength)
      repeat(pointsLength) {
        points.add(LatLngE7(from.readInt(), from.readInt()))
      }
      val point =
          if (from.readBoolean()) {
            WayPoint(from.readVarInt(), readString(from), readNames(from), from.readBoolean())
          } else {
            null
          }
      return Way(id, hash, type, down, up, length, points, point)
    }

    override fun write(v: Way, to: EncodedOutputStream) {
      to.writeVarLong(v.id)
      to.writeInt(v.hash)
      to.writeVarInt(v.type)
      to.writeFloat(v.downMeters)
      to.writeFloat(v.upMeters)
      to.writeFloat(v.lengthMeters)
      to.writeVarInt(v.points.size)
      v.points.forEach {
        to.writeInt(it.lat)
        to.writeInt(it.lng)
      }
      val point = v.point
      to.writeBoolean(point != null)
      if (point != null) {
        to.writeVarInt(point.type)
        writeString(point.name, to)
        writeNames(point.names, to)
        to.writeBoolean(point.notable)
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
      val pointType = from.readVarInt()
      val names = readNames(from)
      val notable = from.readBoolean()
      return WaySkeleton(id, type, nameBytes.decodeToString(), nodes, pointType, names, notable)
    }

    override fun write(v: WaySkeleton, to: EncodedOutputStream) {
      to.writeVarLong(v.id)
      to.writeVarInt(v.type)
      val bytes = v.name.encodeToByteArray()
      to.writeVarInt(bytes.size)
      to.write(bytes)
      to.writeVarInt(v.nodes.size)
      v.nodes.forEach { to.writeVarLong(it) }
      to.writeVarInt(v.pointType)
      writeNames(v.names, to)
      to.writeBoolean(v.notable)
    }
  })
}
