package org.trailcatalog.importers.basemap;

import com.google.common.geometry.S2Polyline;

public record Trail(
    long relationId,
    int type,
    String name,
    long[] paths,
    S2Polyline polyline,
    float downMeters,
    float upMeters,
    int flags) {
}
