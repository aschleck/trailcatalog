package org.trailcatalog.flags

import com.google.common.collect.ImmutableMap
import org.reflections.Reflections
import org.reflections.scanners.Scanners
import org.reflections.util.ClasspathHelper
import org.reflections.util.ConfigurationBuilder
import java.util.regex.Pattern

private val FLAG = Pattern.compile("--(\\w+)=(.+)")

fun createFlag(initial: Boolean): Flag<Boolean> {
  return object : Flag<Boolean>(initial) {
    override fun parseFrom(s: String) = s.toBooleanStrict()
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
            for (arg in args) {
              val matcher = FLAG.matcher(arg)
              if (matcher.matches()) {
                it.put(matcher.group(1), matcher.group(2))
              }
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