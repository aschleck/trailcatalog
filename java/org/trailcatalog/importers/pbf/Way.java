package org.trailcatalog.importers.pbf;

public record Way(long id, int type, String name, long[] nodes) {}
