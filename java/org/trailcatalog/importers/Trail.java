package org.trailcatalog.importers;

import org.trailcatalog.importers.pbf.LatLngE7;

public record Trail(
    long relationId,
    int type,
    long cell,
    String name,
    long[] paths,
    LatLngE7 center,
    double lengthMeters) {
}
