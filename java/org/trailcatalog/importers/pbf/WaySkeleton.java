package org.trailcatalog.importers.pbf;

import java.util.List;

// pointType is the PointCategory of a closed way that also becomes a point, or ANY. names and
// notable are what such a way's Point carries, and empty and false otherwise.
public record WaySkeleton(
    long id,
    int type,
    // See PathTrait
    int traits,
    String name,
    long[] nodes,
    int pointType,
    List<Name> names,
    boolean notable) {}
