package org.trailcatalog.importers.elevation.contour

import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2LatLngRect

private const val SPLIT_THRESHOLD = 100
private const val MIN_HALF_RADIUS = 1 / 32768.0

class BoundsQuadtree<V>(private val center: S2LatLng, private val halfRadius: Double) {

  private val values = ArrayList<Pair<V, S2LatLngRect>>()
  private var children = ArrayList<BoundsQuadtree<V>>()
  private var valueCount = 0

  fun delete(bound: S2LatLngRect): Boolean {
    if ((bound.latLo() <= this.center.lat() && this.center.lat() <= bound.latHi()) ||
        (bound.lngLo() <= this.center.lng() && this.center.lng() <= bound.lngHi())) {
      return this.values.removeIf { it.second == bound }
    }

    if (this.children.isNotEmpty()) {
      // We know that the bound is fully contained by a child, so we can just test any point.
      val xi = if (bound.latLo() <= this.center.lat()) 1 else 0
      val yi = if (bound.lngLo() <= this.center.lng()) 1 else 0
      val child = this.children[(xi shl 1) + yi]
      val deleted = child.delete(bound);
      if (deleted) {
        this.valueCount -= 1;
      }

      if (this.valueCount < SPLIT_THRESHOLD) {
        this.pushAllValuesInto(this.values);
        this.children.clear();
      }

      return deleted;
    } else {
      return this.values.removeIf { it.second == bound }
    }
  }

  fun insert(value: V, bound: S2LatLngRect) {
    this.valueCount += 1;

    if ((bound.latLo() <= this.center.lat() && this.center.lat() <= bound.latHi()) ||
        (bound.lngLo() <= this.center.lng() && this.center.lng() <= bound.lngHi())) {
      this.values.add(Pair(value, bound));
      return;
    }

    if (this.children.isNotEmpty()) {
      // We know that the bound is fully contained by a child, so we can just test any point.
      val xi = if (bound.latLo() <= this.center.lat()) 1 else 0
      val yi = if (bound.lngLo() <= this.center.lng()) 1 else 0
      val child = this.children[(xi shl 1) + yi];
      child.insert(value, bound);
      return;
    }

    if (this.halfRadius > MIN_HALF_RADIUS && this.values.size + 1 >= SPLIT_THRESHOLD) {
      val halfHalfRadius = this.halfRadius / 2;
      this.children.add(
          BoundsQuadtree(
              S2LatLng.fromRadians(
                 this.center.latRadians() + this.halfRadius,
                 this.center.lngRadians() + this.halfRadius),
              halfHalfRadius))
      this.children.add(
          BoundsQuadtree(
              S2LatLng.fromRadians(
                 this.center.latRadians() + this.halfRadius,
                 this.center.lngRadians() - this.halfRadius),
              halfHalfRadius))
      this.children.add(
          BoundsQuadtree(
              S2LatLng.fromRadians(
                  this.center.latRadians() - this.halfRadius,
                  this.center.lngRadians() + this.halfRadius),
              halfHalfRadius))
      this.children.add(
          BoundsQuadtree(
              S2LatLng.fromRadians(
                  this.center.latRadians() - this.halfRadius,
                  this.center.lngRadians() - this.halfRadius),
              halfHalfRadius))

      val items = ArrayList(this.values)
      this.values.clear()
      for ((sv, sb) in items) {
        this.insert(sv, sb);
      }
      this.insert(value, bound);
    } else {
      this.values.add(Pair(value, bound));
    }
  }

  fun queryPoint(point: S2LatLng, output: MutableList<V>) {
    for ((value, bound) in this.values) {
      if (bound.contains(point)) {
        output.add(value)
      }
    }

    if (this.children.isNotEmpty()) {
      val cLat = this.center.latRadians()
      val cLng = this.center.lngRadians()
      if (point.latRadians() <= cLat) {
        if (point.lngRadians() <= cLng) {
          this.children[3].queryPoint(point, output);
        } else {
          this.children[2].queryPoint(point, output);
        }
      }
      if (point.latRadians() > cLat) {
        if (point.lngRadians() <= cLng) {
          this.children[1].queryPoint(point, output);
        } else {
          this.children[0].queryPoint(point, output);
        }
      }
    }
  }

  fun queryRect(rect: S2LatLngRect, output: MutableList<V>) {
    for ((value, bound) in this.values) {
      if (rect.intersects(bound)) {
        output.add(value)
      }
    }

    if (this.children.isNotEmpty()) {
      val cLat = this.center.lat()
      val cLng = this.center.lng()
      if (rect.latLo() <= cLat) {
        if (rect.lngLo() <= cLng) {
          this.children[3].queryRect(rect, output);
        }
        if (rect.lngHi() > cLng) {
          this.children[2].queryRect(rect, output);
        }
      }
      if (rect.latHi() > cLat) {
        if (rect.lngLo() <= cLng) {
          this.children[1].queryRect(rect, output);
        }
        if (rect.lngHi() > cLng) {
          this.children[0].queryRect(rect, output);
        }
      }
    }
  }

  private fun pushAllValuesInto(output: MutableList<Pair<V, S2LatLngRect>>) {
    output.addAll(this.values)
    this.children.forEach { it.pushAllValuesInto(output) }
  }
}

fun <V> worldBounds(): BoundsQuadtree<V> {
  return BoundsQuadtree(S2LatLng.CENTER, 0.5);
}
