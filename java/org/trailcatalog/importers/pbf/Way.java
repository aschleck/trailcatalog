package org.trailcatalog.importers.pbf;

import java.util.List;

public record Way(
    long id,
    int hash,
    int type,
    float downMeters,
    float upMeters,
    List<LatLngE7> points) {}
