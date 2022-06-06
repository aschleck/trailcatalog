package org.trailcatalog.importers.pipeline.collections

import com.google.common.reflect.TypeToken
import com.google.protobuf.MessageLite
import java.lang.RuntimeException
import java.lang.reflect.ParameterizedType
import java.lang.reflect.Type
import java.lang.reflect.WildcardType
import java.nio.ByteBuffer

val serializers = HashMap<TypeToken<*>, Serializer<*>>().also {
  it[TypeToken.of(Int::class.java)] = object : Serializer<Int> {
    override fun read(from: ByteBuffer): Int {
      val v = from.asIntBuffer().get()
      from.position(from.position() + 4)
      return v
    }

    override fun write(v: Int, to: ByteBuffer) {
      to.asIntBuffer().put(v)
      to.position(to.position() + 4)
    }
  }

  it[TypeToken.of(java.lang.Integer::class.java)] = object : Serializer<Int> {
    override fun read(from: ByteBuffer): Int {
      val v = from.asIntBuffer().get()
      from.position(from.position() + 4)
      return v
    }

    override fun write(v: Int, to: ByteBuffer) {
      to.asIntBuffer().put(v)
      to.position(to.position() + 4)
    }
  }

  it[TypeToken.of(Long::class.java)] = object : Serializer<Long> {
    override fun read(from: ByteBuffer): Long {
      val v = from.asLongBuffer().get()
      from.position(from.position() + 8)
      return v
    }

    override fun write(v: Long, to: ByteBuffer) {
      to.asLongBuffer().put(v)
      to.position(to.position() + 8)
    }
  }

  it[TypeToken.of(java.lang.Long::class.java)] = object : Serializer<Long> {
    override fun read(from: ByteBuffer): Long {
      val v = from.asLongBuffer().get()
      from.position(from.position() + 8)
      return v
    }

    override fun write(v: Long, to: ByteBuffer) {
      to.asLongBuffer().put(v)
      to.position(to.position() + 8)
    }
  }
}

fun <T : Any> getSerializer(type: TypeToken<out T>): Serializer<T> {
  if (!serializers.containsKey(type)) {
    if (List::class.java.isAssignableFrom(type.rawType)) {
      val parameterized = extractType(type.type) as ParameterizedType
      val value = getSerializer(TypeToken.of(extractType(parameterized.actualTypeArguments[0])))
      serializers[type] = object : Serializer<List<*>> {
        override fun read(from: ByteBuffer): List<*> {
          val length = from.asIntBuffer().get()
          from.position(from.position() + 4)
          return (0 until length).map { value.read(from) }
        }

        override fun write(v: List<*>, to: ByteBuffer) {
          to.asIntBuffer().put(v.size)
          to.position(to.position() + 4)
          for (item in v) {
            value.write(item, to)
          }
        }
      }
    } else if (type.rawType == Pair::class.java) {
      val parameterized = extractType(type.type) as ParameterizedType
      val left = getSerializer(TypeToken.of(extractType(parameterized.actualTypeArguments[0])))
      val right = getSerializer(TypeToken.of(extractType(parameterized.actualTypeArguments[1])))
      serializers[type] = object : Serializer<Pair<*, *>> {
        override fun read(from: ByteBuffer): Pair<*, *> {
          return Pair(left.read(from), right.read(from))
        }

        override fun write(v: Pair<*, *>, to: ByteBuffer) {
          left.write(v.first, to)
          right.write(v.second, to)
        }
      }
    } else if (type.isSubtypeOf(TypeToken.of(MessageLite::class.java))) {
      val instance = type.rawType.getConstructor().newInstance() as MessageLite
      val parser = instance.parserForType
      serializers[type] = object : Serializer<MessageLite> {
        override fun read(from: ByteBuffer): MessageLite {
          return parser.parseFrom(from)
        }

        override fun write(v: MessageLite, to: ByteBuffer) {
          to.put(v.toByteArray())
        }
      }
    } else {
      throw RuntimeException(
          "No serializer registered for ${type}")
    }
  }

  return serializers.get(type) as Serializer<T>
}

private fun extractType(type: Type): Type {
  if (type is WildcardType) {
    return type.upperBounds[0]
  } else {
    return type
  }
}

fun <T : Any> registerSerializer(type: TypeToken<T>, serializer: Serializer<T>) {
  serializers[type] = serializer
}

fun storeInMemory(byteSize: Long): Boolean {
  return byteSize < 10 * 1024 * 1024
}

fun workerCount(): Int {
  return 2
}