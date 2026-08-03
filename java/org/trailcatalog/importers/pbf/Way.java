package org.trailcatalog.importers.pbf;

import java.util.List;

public record Way(
    long id,
    int hash,
    int type,
    float downMeters,
    float upMeters,
    // Along the ground, so it includes the rise. Ways with no elevation profile carry arclength.
    float lengthMeters,
    List<LatLngE7> points) {}
