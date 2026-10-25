/**
 * @fileoverview Adds SimpleS2 to the classes @com_google_geometry_s2//js:npm_exports exposes.
 */
goog.module('org.trailcatalog.s2.exports');

const SimpleS2 = goog.require('org.trailcatalog.s2.SimpleS2');

$s2exports['SimpleS2'] = SimpleS2;
goog.exportProperty(SimpleS2, 'EARTH_RADIUS_METERS', SimpleS2.EARTH_RADIUS_METERS);
goog.exportProperty(SimpleS2, 'HIGHEST_COARSE_INDEX_LEVEL', SimpleS2.HIGHEST_COARSE_INDEX_LEVEL);
goog.exportProperty(SimpleS2, 'HIGHEST_FINE_INDEX_LEVEL', SimpleS2.HIGHEST_FINE_INDEX_LEVEL);
goog.exportProperty(SimpleS2, 'HIGHEST_OVERVIEW_INDEX_LEVEL', SimpleS2.HIGHEST_OVERVIEW_INDEX_LEVEL);
goog.exportProperty(SimpleS2, 'angleToEarthMeters', SimpleS2.angleToEarthMeters);
goog.exportProperty(SimpleS2, 'cover', SimpleS2.cover);
goog.exportProperty(SimpleS2, 'douglasPeucker', SimpleS2.douglasPeucker);
goog.exportProperty(SimpleS2, 'earthMetersToAngle', SimpleS2.earthMetersToAngle);
goog.exportProperty(SimpleS2, 'snapEpsilon', SimpleS2.snapEpsilon);
goog.exportProperty(SimpleS2, 'snapRadians', SimpleS2.snapRadians);
