package org.trailcatalog.importers.pipeline.collections

import com.google.common.reflect.TypeToken
import com.google.protobuf.MessageLite
import com.google.protobuf.Parser
import org.trailcatalog.importers.pipeline.io.EncodedInputStream
import org.trailcatalog.common.EncodedOutputStream
import java.lang.RuntimeException
import java.lang.reflect.ParameterizedType
import java.lang.reflect.Type
import java.lang.reflect.WildcardType

val serializers = HashMap<TypeToken<*>, Serializer<*>>().also {
  it[TypeToken.of(Int::class.java)] = object : Serializer<Int> {
    override fun read(from: EncodedInputStream): Int {
      return from.readInt()
    }

    override fun write(v: Int, to: EncodedOutputStream) {
      to.writeInt(v)
    }
  }

  it[TypeToken.of(java.lang.Integer::class.java)] = object : Serializer<Int> {
    override fun read(from: EncodedInputStream): Int {
      return from.readInt()
    }

    override fun write(v: Int, to: EncodedOutputStream) {
      to.writeInt(v)
    }
  }

  it[TypeToken.of(Long::class.java)] = object : Serializer<Long> {
    override fun read(from: EncodedInputStream): Long {
      return from.readLong()
    }

    override fun write(v: Long, to: EncodedOutputStream) {
      to.writeLong(v)
    }
  }

  it[TypeToken.of(String::class.java)] = object : Serializer<String> {
    override fun read(from: EncodedInputStream): String {
      return ByteArray(from.readVarInt()).also {
        from.read(it)
      }.decodeToString()
    }

    override fun write(v: String, to: EncodedOutputStream) {
      v.encodeToByteArray().let {
        to.writeVarInt(it.size)
        to.write(it)
      }
    }
  }

  it[TypeToken.of(java.lang.Long::class.java)] = object : Serializer<Long> {
    override fun read(from: EncodedInputStream): Long {
      return from.readLong()
    }

    override fun write(v: Long, to: EncodedOutputStream) {
      to.writeLong(v)
    }
  }
}

fun <T : Any> getSerializer(type: TypeToken<out T>): Serializer<T> {
  if (!serializers.containsKey(type)) {
    if (List::class.java.isAssignableFrom(type.rawType)) {
      val parameterized = extractType(type.type) as ParameterizedType
      val value = getSerializer(TypeToken.of(extractType(parameterized.actualTypeArguments[0])))
      serializers[type] = object : Serializer<List<*>> {
        override fun read(from: EncodedInputStream): List<*> {
          val length = from.readVarInt()
          return (0 until length).map { value.read(from) }
        }

        override fun write(v: List<*>, to: EncodedOutputStream) {
          to.writeVarInt(v.size)
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
        override fun read(from: EncodedInputStream): Pair<*, *> {
          return Pair(left.read(from), right.read(from))
        }

        override fun write(v: Pair<*, *>, to: EncodedOutputStream) {
          left.write(v.first, to)
          right.write(v.second, to)
        }
      }
    } else if (type.isSubtypeOf(TypeToken.of(MessageLite::class.java))) {
      val parser = type.rawType.getMethod("parser").invoke(null) as Parser<MessageLite>
      serializers[type] = object : Serializer<MessageLite> {
        override fun read(from: EncodedInputStream): MessageLite {
          return parser.parseDelimitedFrom(from)
        }

        override fun write(v: MessageLite, to: EncodedOutputStream) {
          v.writeDelimitedTo(to)
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
