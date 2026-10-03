package org.trailcatalog.importers.pbf;

import java.util.List;

// pointType is the PointCategory of a closed way that also becomes a point, or ANY. names is every
// name tag such a way carries, and empty otherwise.
public record WaySkeleton(
    long id, int type, String name, long[] nodes, int pointType, List<Name> names) {}
