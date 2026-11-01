package org.trailcatalog.importers.pbf;

import java.util.List;

// What a closed way with a point type carries into the Point it becomes, see MakeWayPoints, and
// into the boundary it becomes when boundaryType isn't RelationCategory.ANY, see MakeWayBoundaries.
public record WayPoint(
    int type, String name, List<Name> names, boolean notable, int boundaryType) {}
