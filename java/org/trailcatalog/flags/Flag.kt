package org.trailcatalog.flags

abstract class Flag<T>(
    private var _value: T,
    val defaultMissingValue: String? = null,
    val requireValue: Boolean = true) {

  val value: T get() = this._value

  fun parseAndSave(s: String) {
    _value = parseFrom(s)
  }

  protected abstract fun parseFrom(s: String): T;
}