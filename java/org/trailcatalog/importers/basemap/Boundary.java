package org.trailcatalog.importers.basemap;

import java.util.List;
import org.trailcatalog.importers.pbf.Name;

public record Boundary(
    long id,
    int type,
    long cell,
    String name,
    List<Name> names,
    byte[] s2Polygon,
    double areaMeters2) {}
