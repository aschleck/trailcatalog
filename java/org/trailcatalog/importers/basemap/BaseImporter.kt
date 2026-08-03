package org.trailcatalog.importers.basemap

import com.google.common.geometry.S2CellId
import com.google.common.geometry.S2Point
import com.google.common.geometry.S2Polyline
import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pbf.LatLngE7
import org.trailcatalog.importers.pbf.readNames
import org.trailcatalog.importers.pbf.registerPbfSerializers
import org.trailcatalog.importers.pbf.writeNames
import org.trailcatalog.importers.pipeline.collections.Serializer
import org.trailcatalog.importers.pipeline.collections.registerSerializer
import org.trailcatalog.common.EncodedInputStream
import org.trailcatalog.common.EncodedOutputStream

fun registerBaseMapSerializers() {
  registerPbfSerializers()

  registerSerializer(TypeToken.of(Boundary::class.java), object : Serializer<Boundary> {
    override fun read(from: EncodedInputStream): Boundary {
      val id = from.readLong()
      val type = from.readInt()
      val cell = from.readLong()
      val name = ByteArray(from.readVarInt()).also {
        from.read(it)
      }.decodeToString()
      val names = readNames(from)
      val polygon = ByteArray(from.readVarInt()).also {
        from.read(it)
      }
      val areaMeters2 = from.readDouble()
      return Boundary(id, type, cell, name, names, polygon, areaMeters2)
    }

    override fun write(v: Boundary, to: EncodedOutputStream) {
      to.writeLong(v.id)
      to.writeInt(v.type)
      to.writeLong(v.cell)
      val name = v.name.encodeToByteArray()
      to.writeVarInt(name.size)
      to.write(name)
      writeNames(v.names, to)
      to.writeVarInt(v.s2Polygon.size)
      to.write(v.s2Polygon)
      to.writeDouble(v.areaMeters2)
    }
  })

  registerSerializer(TypeToken.of(Profile::class.java), object : Serializer<Profile> {

    override fun read(from: EncodedInputStream): Profile {
      val id = from.readVarLong()
      val hash = from.readInt()
      val down = from.readDouble()
      val up = from.readDouble()
      val length = from.readDouble()
      val profile = ArrayList<Float>()
      for (i in 0 until from.readVarInt()) {
        profile.add(from.readFloat())
      }
      return Profile(id, hash, down, up, length, profile)
    }

    override fun write(v: Profile, to: EncodedOutputStream) {
      to.writeVarLong(v.id)
      to.writeInt(v.hash)
      to.writeDouble(v.down)
      to.writeDouble(v.up)
      to.writeDouble(v.length)
      to.writeVarInt(v.profile.size)
      v.profile.forEach { to.writeFloat(it) }
    }
  })

  registerSerializer(TypeToken.of(Trail::class.java), object : Serializer<Trail> {
    override fun read(from: EncodedInputStream): Trail {
      val id = from.readLong()
      val type = from.readInt()
      val name = ByteArray(from.readVarInt()).also {
        from.read(it)
      }.decodeToString()
      val names = readNames(from)
      val paths = LongArray(from.readVarInt()).also { array ->
        for (i in 0 until array.size) {
          array[i] = from.readLong()
        }
      }
      val pointCount = from.readVarInt()
      val points = ArrayList<S2Point>(pointCount)
      repeat(pointCount) {
        points.add(LatLngE7(from.readInt(), from.readInt()).toS2LatLng().toPoint())
      }
      val polyline = S2Polyline(points)
      val downMeters = from.readFloat()
      val upMeters = from.readFloat()
      val lengthMeters = from.readFloat()
      val validGeometry = from.readBoolean()
      return Trail(
          id, type, name, names, paths, polyline, downMeters, upMeters, lengthMeters, validGeometry)
    }

    override fun write(v: Trail, to: EncodedOutputStream) {
      to.writeLong(v.relationId)
      to.writeInt(v.type)
      val name = v.name.encodeToByteArray()
      to.writeVarInt(name.size)
      to.write(name)
      writeNames(v.names, to)
      to.writeVarInt(v.paths.size)
      v.paths.forEach { to.writeLong(it) }
      to.writeVarInt(v.polyline.numVertices())
      v.polyline.vertices().forEach {
        val latLng = LatLngE7.fromS2Point(it)
        to.writeInt(latLng.lat)
        to.writeInt(latLng.lng)
      }
      to.writeFloat(v.downMeters)
      to.writeFloat(v.upMeters)
      to.writeFloat(v.lengthMeters)
      to.writeBoolean(v.validGeometry)
    }
  })

  registerSerializer(TypeToken.of(S2CellId::class.java), object : Serializer<S2CellId> {
    override fun read(from: EncodedInputStream): S2CellId {
      return S2CellId(from.readLong())
    }

    override fun write(v: S2CellId, to: EncodedOutputStream) {
      to.writeLong(v.id())
    }
  })
}
