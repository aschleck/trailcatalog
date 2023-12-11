goog.module('org.trailcatalog.s2.externs');

const R1Interval = goog.require('com.google.common.geometry.R1Interval');
goog.exportSymbol('com.google.common.geometry.R1Interval', R1Interval);
goog.exportProperty(R1Interval.prototype, 'hi', R1Interval.prototype.hi);
goog.exportProperty(R1Interval.prototype, 'lo', R1Interval.prototype.lo);

const S1Angle = goog.require('com.google.common.geometry.S1Angle');
goog.exportSymbol('com.google.common.geometry.S1Angle', S1Angle);
goog.exportProperty(S1Angle, 'degrees', S1Angle.degrees);
goog.exportProperty(S1Angle, 'e7', S1Angle.e7);
goog.exportProperty(S1Angle.prototype, 'radians', S1Angle.prototype.radians);

const S1Interval = goog.require('com.google.common.geometry.S1Interval');
goog.exportSymbol('com.google.common.geometry.S1Interval', S1Interval);
goog.exportProperty(S1Interval.prototype, 'hi', S1Interval.prototype.hi);
goog.exportProperty(S1Interval.prototype, 'lo', S1Interval.prototype.lo);

const S2Cell = goog.require('com.google.common.geometry.S2Cell');
goog.exportSymbol('com.google.common.geometry.S2Cell', S2Cell);
goog.exportProperty(S2Cell.prototype, 'exactArea', S2Cell.prototype.exactArea);

const S2CellId = goog.require('com.google.common.geometry.S2CellId');
goog.exportSymbol('com.google.common.geometry.S2CellId', S2CellId);
goog.exportProperty(S2CellId, 'fromLatLng', S2CellId.fromLatLng);
goog.exportProperty(S2CellId, 'fromPoint', S2CellId.fromPoint);
goog.exportProperty(S2CellId, 'fromToken', S2CellId.fromToken);
goog.exportProperty(S2CellId.prototype, 'id', S2CellId.prototype.id);
goog.exportProperty(S2CellId.prototype, 'level', S2CellId.prototype.level);
goog.exportProperty(S2CellId.prototype, 'parentAtLevel', S2CellId.prototype.parentAtLevel);
goog.exportProperty(S2CellId.prototype, 'rangeMax', S2CellId.prototype.rangeMax);
goog.exportProperty(S2CellId.prototype, 'rangeMin', S2CellId.prototype.rangeMin);
goog.exportProperty(S2CellId.prototype, 'toLoop', S2CellId.prototype.toLoop);
goog.exportProperty(S2CellId.prototype, 'toToken', S2CellId.prototype.toToken);

const S2CellUnion = goog.require('com.google.common.geometry.S2CellUnion');
goog.exportSymbol('com.google.common.geometry.S2CellUnion', S2CellUnion);
goog.exportProperty(S2CellUnion.prototype, 'cellIds', S2CellUnion.prototype.cellIds);
goog.exportProperty(S2CellUnion.prototype, 'containsCellId', S2CellUnion.prototype.containsCellId);
goog.exportProperty(S2CellUnion.prototype, 'initRawCellIds', S2CellUnion.prototype.initRawCellIds);
goog.exportProperty(S2CellUnion.prototype, 'intersectsCellId', S2CellUnion.prototype.intersectsCellId);
goog.exportProperty(S2CellUnion.prototype, 'size', S2CellUnion.prototype.size);

const S2LatLng = goog.require('com.google.common.geometry.S2LatLng');
goog.exportSymbol('com.google.common.geometry.S2LatLng', S2LatLng);
goog.exportProperty(S2LatLng, 'fromDegrees', S2LatLng.fromDegrees);
goog.exportProperty(S2LatLng, 'fromRadians', S2LatLng.fromRadians);
goog.exportProperty(S2LatLng.prototype, 'equals', S2LatLng.prototype.equals);
goog.exportProperty(S2LatLng.prototype, 'getDistance', S2LatLng.prototype.getDistance);
goog.exportProperty(S2LatLng.prototype, 'latDegrees', S2LatLng.prototype.latDegrees);
goog.exportProperty(S2LatLng.prototype, 'lngDegrees', S2LatLng.prototype.lngDegrees);
goog.exportProperty(S2LatLng.prototype, 'latRadians', S2LatLng.prototype.latRadians);
goog.exportProperty(S2LatLng.prototype, 'lngRadians', S2LatLng.prototype.lngRadians);
goog.exportProperty(S2LatLng.prototype, 'toPoint', S2LatLng.prototype.toPoint);
goog.exportProperty(S2LatLng.prototype, 'toStringDegrees', S2LatLng.prototype.toStringDegrees);

const S2LatLngRect = goog.require('com.google.common.geometry.S2LatLngRect');
goog.exportSymbol('com.google.common.geometry.S2LatLngRect', S2LatLngRect);
goog.exportProperty(S2LatLngRect, 'empty', S2LatLngRect.empty);
goog.exportProperty(S2LatLngRect, 'fromPoint', S2LatLngRect.fromPoint);
goog.exportProperty(S2LatLngRect, 'fromPointPair', S2LatLngRect.fromPointPair);
goog.exportProperty(S2LatLngRect.prototype, 'area', S2LatLngRect.prototype.area);
goog.exportProperty(S2LatLngRect.prototype, 'contains', S2LatLngRect.prototype.contains);
goog.exportProperty(S2LatLngRect.prototype, 'expanded', S2LatLngRect.prototype.expanded);
goog.exportProperty(S2LatLngRect.prototype, 'expandedByDistance', S2LatLngRect.prototype.expandedByDistance);
goog.exportProperty(S2LatLngRect.prototype, 'getCenter', S2LatLngRect.prototype.getCenter);
goog.exportProperty(S2LatLngRect.prototype, 'getSize', S2LatLngRect.prototype.getSize);
goog.exportProperty(S2LatLngRect.prototype, 'intersects', S2LatLngRect.prototype.intersects);
goog.exportProperty(S2LatLngRect.prototype, 'lo', S2LatLngRect.prototype.lo);
goog.exportProperty(S2LatLngRect.prototype, 'hi', S2LatLngRect.prototype.hi);
goog.exportProperty(S2LatLngRect.prototype, 'lat', S2LatLngRect.prototype.lat);
goog.exportProperty(S2LatLngRect.prototype, 'lng', S2LatLngRect.prototype.lng);
goog.exportProperty(S2LatLngRect.prototype, 'toStringDegrees', S2LatLngRect.prototype.toStringDegrees);

const S2Loop = goog.require('com.google.common.geometry.S2Loop');
goog.exportSymbol('com.google.common.geometry.S2Loop', S2Loop);
goog.exportProperty(S2Loop.prototype, 'intersects', S2Loop.prototype.intersects);
goog.exportProperty(S2Loop.prototype, 'isHole', S2Loop.prototype.isHole);
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
goog.exportProperty(S2Polygon.prototype, 'containsPoint', S2Polygon.prototype.containsPoint);
goog.exportProperty(S2Polygon.prototype, 'getArea', S2Polygon.prototype.getArea);
goog.exportProperty(S2Polygon.prototype, 'getLoops', S2Polygon.prototype.getLoops);
goog.exportProperty(S2Polygon.prototype, 'getRectBound', S2Polygon.prototype.getRectBound);
goog.exportProperty(S2Polygon.prototype, 'initToIntersection', S2Polygon.prototype.initToIntersection);
goog.exportProperty(S2Polygon.prototype, 'initToIntersectionSloppy', S2Polygon.prototype.initToIntersectionSloppy);
goog.exportProperty(S2Polygon.prototype, 'initToUnion', S2Polygon.prototype.initToUnion);
goog.exportProperty(S2Polygon.prototype, 'initToUnionSloppy', S2Polygon.prototype.initToUnionSloppy);
goog.exportProperty(S2Polygon.prototype, 'intersects', S2Polygon.prototype.intersects);
goog.exportProperty(S2Polygon.prototype, 'loop', S2Polygon.prototype.loop);
goog.exportProperty(S2Polygon.prototype, 'numLoops', S2Polygon.prototype.numLoops);

//const S2PolygonBuilder = goog.require('com.google.common.geometry.S2PolygonBuilder');
//goog.exportSymbol('com.google.common.geometry.S2PolygonBuilder', S2PolygonBuilder);
//goog.exportProperty(S2PolygonBuilder.prototype, 'addEdge', S2PolygonBuilder.prototype.addEdge);
//goog.exportProperty(S2PolygonBuilder.prototype, 'getPolygon', S2PolygonBuilder.prototype.getPolygon);
//
//const S2PolygonBuilderOptions = goog.require('com.google.common.geometry.S2PolygonBuilder.Options');
//goog.exportSymbol('com.google.common.geometry.S2PolygonBuilderOptions', S2PolygonBuilderOptions);
//goog.exportProperty(S2PolygonBuilderOptions, 'DIRECTED_UNION', S2PolygonBuilderOptions.DIRECTED_UNION);
//goog.exportProperty(S2PolygonBuilderOptions, 'DIRECTED_XOR', S2PolygonBuilderOptions.DIRECTED_XOR);
//goog.exportProperty(S2PolygonBuilderOptions, 'UNDIRECTED_UNION', S2PolygonBuilderOptions.UNDIRECTED_UNION);
//goog.exportProperty(S2PolygonBuilderOptions, 'UNDIRECTED_XOR', S2PolygonBuilderOptions.UNDIRECTED_XOR);

// This is insane but yolo!
const GetLoopsList = goog.require('com.google.common.geometry.S2Polygon.$3$impl');
goog.exportSymbol('com.google.common.geometry.S2Polygon.$3$impl', GetLoopsList);
goog.exportProperty(GetLoopsList.prototype, 'getAtIndex', GetLoopsList.prototype.getAtIndex);
goog.exportProperty(GetLoopsList.prototype, 'size', GetLoopsList.prototype.size);

const ArrayList = goog.require('java.util.ArrayList');
goog.exportSymbol('java.util.ArrayList', ArrayList);
goog.exportProperty(ArrayList.prototype, 'add', ArrayList.prototype.add);
goog.exportProperty(ArrayList.prototype, 'getAtIndex', ArrayList.prototype.getAtIndex);
goog.exportProperty(ArrayList.prototype, 'size', ArrayList.prototype.size);

const Long = goog.require('nativebootstrap.Long');
goog.exportSymbol('nativebootstrap.Long', Long);
goog.exportProperty(Long, 'fromBits', Long.fromBits);
goog.exportProperty(Long, 'fromString', Long.fromString);
goog.exportProperty(Long.prototype, 'getHighBits', Long.prototype.getHighBits);
goog.exportProperty(Long.prototype, 'getLowBits', Long.prototype.getLowBits);
goog.exportProperty(Long.prototype, 'toString', Long.prototype.toString);

const SimpleS2 = goog.require('org.trailcatalog.s2.SimpleS2');
goog.exportSymbol('org.trailcatalog.s2.SimpleS2', SimpleS2);
goog.exportProperty(SimpleS2, 'EARTH_RADIUS_METERS', SimpleS2.EARTH_RADIUS_METERS);
goog.exportProperty(SimpleS2, 'HIGHEST_COARSE_INDEX_LEVEL', SimpleS2.HIGHEST_COARSE_INDEX_LEVEL);
goog.exportProperty(SimpleS2, 'HIGHEST_FINE_INDEX_LEVEL', SimpleS2.HIGHEST_FINE_INDEX_LEVEL);
goog.exportProperty(SimpleS2, 'HIGHEST_OVERVIEW_INDEX_LEVEL', SimpleS2.HIGHEST_OVERVIEW_INDEX_LEVEL);
goog.exportProperty(SimpleS2, 'angleToEarthMeters', SimpleS2.angleToEarthMeters);
goog.exportProperty(SimpleS2, 'cellIdToCell', SimpleS2.cellIdToCell);
goog.exportProperty(SimpleS2, 'cellLevel', SimpleS2.cellLevel);
goog.exportProperty(SimpleS2, 'cover', SimpleS2.cover);
goog.exportProperty(SimpleS2, 'decodeCellUnion', SimpleS2.decodeCellUnion);
goog.exportProperty(SimpleS2, 'decodePolygon', SimpleS2.decodePolygon);
goog.exportProperty(SimpleS2, 'encodePolygon', SimpleS2.encodePolygon);
goog.exportProperty(SimpleS2, 'earthMetersToAngle', SimpleS2.earthMetersToAngle);
goog.exportProperty(SimpleS2, 'pointToLatLng', SimpleS2.pointToLatLng);
goog.exportProperty(SimpleS2, 'pointsToPolygon', SimpleS2.pointsToPolygon);
goog.exportProperty(SimpleS2, 'newArrayList', SimpleS2.newArrayList);
goog.exportProperty(SimpleS2, 'newPolygon', SimpleS2.newPolygon);
