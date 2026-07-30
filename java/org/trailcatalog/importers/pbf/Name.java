package org.trailcatalog.importers.pbf;

// One OSM name tag. Language is the code the key was suffixed with, and is null for a bare key like
// name or short_name.
public record Name(String language, String value) {}
