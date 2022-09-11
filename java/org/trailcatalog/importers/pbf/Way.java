package org.trailcatalog.importers.pbf;

import com.google.common.geometry.S2Polyline;
import java.util.List;

public record Way(long id, int version, int type, String name, S2Polyline polyline) {}
