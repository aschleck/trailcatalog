package org.trailcatalog.importers.pbf;

import java.util.List;
import org.trailcatalog.proto.RelationSkeleton;

// Name is the value of the bare name tag and is what we display, while names is every name tag the
// relation carries, including that one.
public record Relation(
    long id, int type, String name, List<Name> names, RelationSkeleton skeleton) {}
