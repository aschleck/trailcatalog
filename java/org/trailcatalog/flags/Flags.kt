package org.trailcatalog.flags

import com.google.common.collect.ImmutableMap
import org.reflections.Reflections
import org.reflections.scanners.Scanners
import org.reflections.util.ClasspathHelper
import org.reflections.util.ConfigurationBuilder
import java.nio.file.Path
import java.util.regex.Pattern

private val FLAG = Pattern.compile("--(\\w+)")
private val FLAG_AND_VALUE = Pattern.compile("--(\\w+)=(.+)")

fun createFlag(initial: Boolean): Flag<Boolean> {
  return object : Flag<Boolean>(initial, defaultMissingValue = "true", requireValue = false) {
    override fun parseFrom(s: String) = s.toBooleanStrict()
  }
}

fun createFlag(initial: Double): Flag<Double> {
  return object : Flag<Double>(initial) {
    override fun parseFrom(s: String) = s.toDouble()
  }
}

inline fun <reified T : Enum<T>> createFlag(initial: T): Flag<T> {
  return object : Flag<T>(initial) {
    override fun parseFrom(s: String) = enumValueOf<T>(s)
  }
}

fun createFlag(initial: Int): Flag<Int> {
  return object : Flag<Int>(initial) {
    override fun parseFrom(s: String) = s.toInt()
  }
}

fun createFlag(initial: String): Flag<String> {
  return object : Flag<String>(initial) {
    override fun parseFrom(s: String) = s
  }
}

fun createNullableFlag(initial: Path? = null): Flag<Path?> {
  return object : Flag<Path?>(initial) {
    override fun parseFrom(s: String) = Path.of(s)
  }
}

fun createNullableFlag(initial: String? = null): Flag<String?> {
  return object : Flag<String?>(initial) {
    override fun parseFrom(s: String) = s
  }
}

fun parseFlags(args: Array<String>) {
  val flags = collectFlags()
  val parsed =
      ImmutableMap
          .builder<String, String>()
          .also {
            var i = 0
            while (i < args.size) {
              val arg = args[i]

              val kv = FLAG_AND_VALUE.matcher(arg)
              val k = FLAG.matcher(arg)
              if (kv.matches()) {
                it.put(kv.group(1), kv.group(2))
              } else if (k.matches()) {
                val name = k.group(1)
                val flag = flags[name]
                if (flag != null) {
                  if (flag.requireValue) {
                    it.put(name, args[i + 1])
                    i += 1
                  } else if (flag.defaultMissingValue != null) {
                    it.put(name, flag.defaultMissingValue)
                  }
                }
              }

              i += 1
            }
          }
          .build()
  for ((name, value) in parsed) {
    checkNotNull(flags[name]) { "--${name} is an unknown flag" }.parseAndSave(value)
  }
}

private fun collectFlags(): Map<String, Flag<*>> {
  val fields =
      Reflections(
              ConfigurationBuilder()
                  .addUrls(ClasspathHelper.forJavaClassPath())
                  .addScanners(Scanners.FieldsAnnotated))
          .getFieldsAnnotatedWith(FlagSpec::class.java)
  // Use ImmutableMap to catch duplicate keys
  return ImmutableMap.builder<String, Flag<*>>().also {
    for (field in fields) {
      field.isAccessible = true
      val spec = field.getAnnotation(FlagSpec::class.java)
      val flag = field.get(null) as Flag<*>
      it.put(spec.name, flag)
    }
  }.build()
}