package org.trailcatalog.importers;

import org.trailcatalog.importers.pbf.LatLngE7;
import org.trailcatalog.importers.pbf.LatLngRectE7;

public record Trail(
    long relationId,
    int type,
    long cell,
    String name,
    long[] paths,
    LatLngRectE7 bound,
    LatLngE7 marker,
    double lengthMeters) {
}
