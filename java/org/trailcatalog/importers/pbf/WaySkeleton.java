package org.trailcatalog.importers.pbf;

public record WaySkeleton(long id, int version, int type, String name, long[] nodes) {}
