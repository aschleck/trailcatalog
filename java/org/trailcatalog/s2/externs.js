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
goog.exportProperty(S2CellId.prototype, 'level', S2CellId.prototype.level);
goog.exportProperty(S2CellId.prototype, 'toToken', S2CellId.prototype.toToken);

const S1Interval = goog.require('com.google.common.geometry.S1Interval');
goog.exportSymbol('com.google.common.geometry.S1Interval', S1Interval);
goog.exportProperty(S1Interval.prototype, 'hi', S1Interval.prototype.hi);
goog.exportProperty(S1Interval.prototype, 'lo', S1Interval.prototype.lo);

const S2LatLng = goog.require('com.google.common.geometry.S2LatLng');
goog.exportSymbol('com.google.common.geometry.S2LatLng', S2LatLng);
goog.exportProperty(S2LatLng, 'fromDegrees', S2LatLng.fromDegrees);
goog.exportProperty(S2LatLng, 'fromRadians', S2LatLng.fromRadians);
goog.exportProperty(S2LatLng.prototype, 'equals', S2LatLng.prototype.equals);
goog.exportProperty(S2LatLng.prototype, 'latDegrees', S2LatLng.prototype.latDegrees);
goog.exportProperty(S2LatLng.prototype, 'lngDegrees', S2LatLng.prototype.lngDegrees);
goog.exportProperty(S2LatLng.prototype, 'latRadians', S2LatLng.prototype.latRadians);
goog.exportProperty(S2LatLng.prototype, 'lngRadians', S2LatLng.prototype.lngRadians);
goog.exportProperty(S2LatLng.prototype, 'toPoint', S2LatLng.prototype.toPoint);

const S2LatLngRect = goog.require('com.google.common.geometry.S2LatLngRect');
goog.exportSymbol('com.google.common.geometry.S2LatLngRect', S2LatLngRect);
goog.exportProperty(S2LatLngRect, 'fromPoint', S2LatLngRect.fromPoint);
goog.exportProperty(S2LatLngRect, 'fromPointPair', S2LatLngRect.fromPointPair);
goog.exportProperty(S2LatLngRect.prototype, 'expandedByDistance', S2LatLngRect.prototype.expandedByDistance);
goog.exportProperty(S2LatLngRect.prototype, 'lo', S2LatLngRect.prototype.lo);
goog.exportProperty(S2LatLngRect.prototype, 'hi', S2LatLngRect.prototype.hi);
goog.exportProperty(S2LatLngRect.prototype, 'lat', S2LatLngRect.prototype.lat);
goog.exportProperty(S2LatLngRect.prototype, 'lng', S2LatLngRect.prototype.lng);

const S2Loop = goog.require('com.google.common.geometry.S2Loop');
goog.exportSymbol('com.google.common.geometry.S2Loop', S2Loop);
goog.exportProperty(S2Loop.prototype, 'sign', S2Loop.prototype.sign);
goog.exportProperty(S2Loop.prototype, 'numVertices', S2Loop.prototype.numVertices);
goog.exportProperty(S2Loop.prototype, 'vertex', S2Loop.prototype.vertex);
goog.exportProperty(S2Loop.prototype, 'vertices', S2Loop.prototype.vertices);

const S2Point = goog.require('com.google.common.geometry.S2Point');
goog.exportSymbol('com.google.common.geometry.S2Point', S2Point);
goog.exportProperty(S2Point.prototype, 'add', S2Point.prototype.add);
goog.exportProperty(S2Point.prototype, 'angle', S2Point.prototype.angle);
goog.exportProperty(S2Point.prototype, 'div', S2Point.prototype.div);
goog.exportProperty(S2Point.prototype, 'mul', S2Point.prototype.mul);
goog.exportProperty(S2Point.prototype, 'sub', S2Point.prototype.sub);
goog.exportProperty(S2Point.prototype, 'getX', S2Point.prototype.getX);
goog.exportProperty(S2Point.prototype, 'getY', S2Point.prototype.getY);
goog.exportProperty(S2Point.prototype, 'getZ', S2Point.prototype.getZ);

const S2Polygon = goog.require('com.google.common.geometry.S2Polygon');
goog.exportSymbol('com.google.common.geometry.S2Polygon', S2Polygon);
goog.exportProperty(S2Polygon.prototype, 'contains', S2Polygon.prototype.contains);
goog.exportProperty(S2Polygon.prototype, 'getLoops', S2Polygon.prototype.getLoops);
goog.exportProperty(S2Polygon.prototype, 'getRectBound', S2Polygon.prototype.getRectBound);
goog.exportProperty(S2Polygon.prototype, 'loop', S2Polygon.prototype.loop);
goog.exportProperty(S2Polygon.prototype, 'numLoops', S2Polygon.prototype.numLoops);

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
goog.exportProperty(SimpleS2, 'HIGHEST_METADATA_INDEX_LEVEL', SimpleS2.HIGHEST_METADATA_INDEX_LEVEL);
goog.exportProperty(SimpleS2, 'HIGHEST_DETAIL_INDEX_LEVEL', SimpleS2.HIGHEST_DETAIL_INDEX_LEVEL);
goog.exportProperty(SimpleS2, 'cellLevel', SimpleS2.cellLevel);
goog.exportProperty(SimpleS2, 'cover', SimpleS2.cover);
goog.exportProperty(SimpleS2, 'decodePolygon', SimpleS2.decodePolygon);
goog.exportProperty(SimpleS2, 'pointToLatLng', SimpleS2.pointToLatLng);
