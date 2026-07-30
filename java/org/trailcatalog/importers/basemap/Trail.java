package org.trailcatalog.importers.basemap;

import com.google.common.geometry.S2Polyline;
import java.util.List;
import org.trailcatalog.importers.pbf.Name;

public record Trail(
    long relationId,
    int type,
    String name,
    List<Name> names,
    long[] paths,
    S2Polyline polyline,
    float downMeters,
    float upMeters,
    boolean validGeometry) {
}
