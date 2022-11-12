package org.trailcatalog.importers.basemap;

import com.google.common.geometry.S2Polyline;
import org.trailcatalog.importers.pbf.LatLngE7;
import org.trailcatalog.importers.pbf.LatLngRectE7;

public record Trail(
    long relationId,
    int type,
    String name,
    long[] paths,
    S2Polyline polyline) {
}
