goog.module('org.trailcatalog.s2.externs');

const R1Interval = goog.require('com.google.common.geometry.R1Interval');
goog.exportSymbol('com.google.common.geometry.R1Interval', R1Interval);
goog.exportProperty(R1Interval.prototype, 'hi', R1Interval.prototype.hi);
goog.exportProperty(R1Interval.prototype, 'lo', R1Interval.prototype.lo);

const S1Angle = goog.require('com.google.common.geometry.S1Angle');
goog.exportSymbol('com.google.common.geometry.S1Angle', S1Angle);
goog.exportProperty(S1Angle, 'degrees', S1Angle.degrees);

const S2CellId = goog.require('com.google.common.geometry.S2CellId');
goog.exportSymbol('com.google.common.geometry.S2CellId', S2CellId);
goog.exportProperty(S2CellId.prototype, 'id', S2CellId.prototype.id);
goog.exportProperty(S2CellId.prototype, 'toToken', S2CellId.prototype.toToken);

const S1Interval = goog.require('com.google.common.geometry.S1Interval');
goog.exportSymbol('com.google.common.geometry.S1Interval', S1Interval);
goog.exportProperty(S1Interval.prototype, 'hi', S1Interval.prototype.hi);
goog.exportProperty(S1Interval.prototype, 'lo', S1Interval.prototype.lo);

const S2LatLng = goog.require('com.google.common.geometry.S2LatLng');
goog.exportSymbol('com.google.common.geometry.S2LatLng', S2LatLng);
goog.exportProperty(S2LatLng, 'fromDegrees', S2LatLng.fromDegrees);
goog.exportProperty(S2LatLng, 'fromRadians', S2LatLng.fromRadians);
goog.exportProperty(S2LatLng.prototype, 'latDegrees', S2LatLng.prototype.latDegrees);
goog.exportProperty(S2LatLng.prototype, 'lngDegrees', S2LatLng.prototype.lngDegrees);
goog.exportProperty(S2LatLng.prototype, 'latRadians', S2LatLng.prototype.latRadians);
goog.exportProperty(S2LatLng.prototype, 'lngRadians', S2LatLng.prototype.lngRadians);

const S2LatLngRect = goog.require('com.google.common.geometry.S2LatLngRect');
goog.exportSymbol('com.google.common.geometry.S2LatLngRect', S2LatLngRect);
goog.exportProperty(S2LatLngRect, 'fromPoint', S2LatLngRect.fromPoint);
goog.exportProperty(S2LatLngRect, 'fromPointPair', S2LatLngRect.fromPointPair);
goog.exportProperty(S2LatLngRect.prototype, 'expandedByDistance', S2LatLngRect.prototype.expandedByDistance);
goog.exportProperty(S2LatLngRect.prototype, 'lat', S2LatLngRect.prototype.lat);
goog.exportProperty(S2LatLngRect.prototype, 'lng', S2LatLngRect.prototype.lng);

const ArrayList = goog.require('java.util.ArrayList');
goog.exportSymbol('java.util.ArrayList', ArrayList);
goog.exportProperty(ArrayList.prototype, 'getAtIndex', ArrayList.prototype.getAtIndex);
goog.exportProperty(ArrayList.prototype, 'size', ArrayList.prototype.size);

const Long = goog.require('nativebootstrap.Long');
goog.exportSymbol('nativebootstrap.Long', Long);
goog.exportProperty(Long.prototype, 'getHighBits', Long.prototype.getHighBits);
goog.exportProperty(Long.prototype, 'getLowBits', Long.prototype.getLowBits);

const SimpleS2 = goog.require('org.trailcatalog.s2.SimpleS2');
goog.exportSymbol('org.trailcatalog.s2.SimpleS2', SimpleS2);
goog.exportProperty(SimpleS2, 'cover', SimpleS2.cover);

