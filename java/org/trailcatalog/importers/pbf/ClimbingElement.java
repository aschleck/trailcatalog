package org.trailcatalog.importers.pbf;

import java.util.List;
import org.trailcatalog.proto.RelationSkeleton;

// A node, way, or relation that climbing sites take their shape from. Id is the id of the boundary
// it would become, see ExtractClimbingElements#nodeSiteId. Type is the RelationCategory of that
// boundary, or BOUNDARY_CLIMBING for an element that only shapes the sites holding it. LatLng is
// null except on nodes, because ways get their geometry from MakeWayGeometries, and members is
// empty except on relations.
public record ClimbingElement(
    long id,
    int type,
    String name,
    List<Name> names,
    LatLngE7 latLng,
    RelationSkeleton members) {}
