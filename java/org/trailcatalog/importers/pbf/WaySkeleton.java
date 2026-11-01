package org.trailcatalog.importers.pbf;

import java.util.List;

// pointType is the PointCategory of a closed way that also becomes a point, or ANY. names and
// notable are what such a way's Point carries, and empty and false otherwise. boundaryType is the
// RelationCategory of a closed way that also becomes a boundary, or ANY.
public record WaySkeleton(
    long id,
    int type,
    // See PathTrait
    int traits,
    String name,
    long[] nodes,
    int pointType,
    List<Name> names,
    boolean notable,
    int boundaryType) {}
