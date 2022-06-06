package org.trailcatalog.importers.pbf;

import org.trailcatalog.proto.RelationSkeleton;

public record Relation(long id, int type, String name, RelationSkeleton skeleton) {}
