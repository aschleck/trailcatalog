package org.trailcatalog.importers.pipeline.collections

import com.google.common.collect.ImmutableListMultimap
import com.google.common.collect.ListMultimap
import java.util.ArrayList
import kotlin.math.max
import kotlin.math.min

open class InMemoryPList<T>(val estimatedByteSize: Long, val list: List<T>) : PList<T> {

  private val iterator = list.iterator()

  override fun estimatedByteSize(): Long {
    return estimatedByteSize
  }

  override fun hasNext() = iterator.hasNext()

  override fun next(): T = iterator.next()
}

open class InMemoryPMap<K : Comparable<K>, V>(
    val estimatedByteSize: Long, val map: ListMultimap<K, V>)
  : PMap<K, V> {

  private val iterator = map.keySet().iterator()

  override fun estimatedByteSize(): Long {
    return estimatedByteSize
  }

  override fun hasNext() = iterator.hasNext()

  override fun next(): PEntry<K, V> {
    val next = iterator.next()
    return PEntry(next, map.get(next))
  }
}

class InMemoryPSortedList<T : Comparable<T>>(
    estimatedByteSize: Long, list: List<T>)
  : InMemoryPList<T>(estimatedByteSize, list), PSortedList<T> {

  override fun find(needle: (v: T) -> Int): T? {
    var cursor = list.size / 2
    var window = cursor + 1
    while (window > 0) {
      val value = list[cursor]
      when (needle.invoke(value)) {
        -1 -> {
          window /= 2
          cursor = max(0, cursor - window)
        }
        0 -> {
          return value
        }
        1 -> {
          window /= 2
          cursor = min(list.size - 1, cursor + window)
        }
        else -> {
          throw RuntimeException("Bad comparator return value")
        }
      }
    }
    return null
  }
}

fun <T> createInMemoryPList(estimatedByteSize: Long, fn: (Emitter<T>) -> Unit):
    () -> InMemoryPList<T> {
  val list = ArrayList<T>()
  val emitter = object : Emitter<T> {
    override fun emit(v: T) {
      list.add(v)
    }
  }
  fn(emitter)
  println("PList (InMemory) ${list[0]!!::class.simpleName} count ${list.size}")
  return {
    InMemoryPList(estimatedByteSize, list)
  }
}

fun <K : Comparable<K>, V : Any> createInMemoryPMap(
    estimatedByteSize: Long, fn: (Emitter2<K, V>) -> Unit):
    () -> InMemoryPMap<K, V> {
  val entries = ArrayList<Pair<K, V>>()
  var key: K? = null
  var value: V? = null
  val emitter = object : Emitter2<K, V> {
    override fun emit(a: K, b: V) {
      key = a
      value = b
      entries.add(Pair(a, b))
    }
  }
  fn(emitter)
  entries.sortBy { it.first }
  val map = ImmutableListMultimap.builder<K, V>()
  for (entry in entries) {
    map.put(entry.first, entry.second)
  }

  val built = map.build()
  if (built.isEmpty) {
    println("PMap (InMemory) empty count ${built.size()}")
  } else {
    println(
        "PMap (InMemory) ${key!!::class.simpleName} -> " +
            "${value!!::class.simpleName} count ${built.size()}")
  }
  return {
    InMemoryPMap(estimatedByteSize, built)
  }
}

fun <T : Comparable<T>> createInMemoryPSortedList(estimatedByteSize: Long, fn: (Emitter<T>) -> Unit):
    () -> InMemoryPSortedList<T> {
  val list = ArrayList<T>()
  var last: T? = null
  val emitter = object : Emitter<T> {
    override fun emit(v: T) {
      val was = last
      if (was != null) {
        if (was.compareTo(v) != -1) {
          throw RuntimeException("Sorted order was violated")
        }
      }
      last = v
      list.add(v)
    }
  }
  fn(emitter)
  println("PSortedList (InMemory) ${list[0]!!::class.simpleName} count ${list.size}")
  return {
    InMemoryPSortedList(estimatedByteSize, list)
  }
}
