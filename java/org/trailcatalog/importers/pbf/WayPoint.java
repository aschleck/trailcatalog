package org.trailcatalog.importers.pbf;

import java.util.List;

/** What a closed way with a point type carries into the Point it becomes. See MakeWayPoints. */
public record WayPoint(int type, String name, List<Name> names, boolean notable) {}
