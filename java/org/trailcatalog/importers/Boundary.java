package org.trailcatalog.importers;

public record Boundary(long id, int type, long cell, String name, byte[] s2Polygon) {}
