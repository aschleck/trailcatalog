package org.trailcatalog.models

// Enum scheme: each enum can have `ENUM_SIZE` children, ranging from id
// parent.id * ENUM_SIZE + 1 to parent.id * ENUM_SIZE + ENUM_SIZE.
private const val ENUM_SIZE = 64

enum class RelationCategory(val id: Int) {
  ANY(0),
    BOUNDARY(ANY.id * ENUM_SIZE + 1),
      BOUNDARY_ABORIGINAL_LANDS(BOUNDARY.id * ENUM_SIZE + 1),
      BOUNDARY_ADMINISTRATIVE(BOUNDARY.id * ENUM_SIZE + 2),
        BOUNDARY_ADMINISTRATIVE_1(BOUNDARY_ADMINISTRATIVE.id * ENUM_SIZE + 1),
        BOUNDARY_ADMINISTRATIVE_2(BOUNDARY_ADMINISTRATIVE.id * ENUM_SIZE + 2),
        BOUNDARY_ADMINISTRATIVE_3(BOUNDARY_ADMINISTRATIVE.id * ENUM_SIZE + 3),
        BOUNDARY_ADMINISTRATIVE_4(BOUNDARY_ADMINISTRATIVE.id * ENUM_SIZE + 4),
        BOUNDARY_ADMINISTRATIVE_5(BOUNDARY_ADMINISTRATIVE.id * ENUM_SIZE + 5),
        BOUNDARY_ADMINISTRATIVE_6(BOUNDARY_ADMINISTRATIVE.id * ENUM_SIZE + 6),
        BOUNDARY_ADMINISTRATIVE_7(BOUNDARY_ADMINISTRATIVE.id * ENUM_SIZE + 7),
        BOUNDARY_ADMINISTRATIVE_8(BOUNDARY_ADMINISTRATIVE.id * ENUM_SIZE + 8),
        BOUNDARY_ADMINISTRATIVE_9(BOUNDARY_ADMINISTRATIVE.id * ENUM_SIZE + 9),
        BOUNDARY_ADMINISTRATIVE_10(BOUNDARY_ADMINISTRATIVE.id * ENUM_SIZE + 10),
        BOUNDARY_ADMINISTRATIVE_11(BOUNDARY_ADMINISTRATIVE.id * ENUM_SIZE + 11),
      BOUNDARY_FOREST(BOUNDARY.id * ENUM_SIZE + 3),
      BOUNDARY_NATIONAL_PARK(BOUNDARY.id * ENUM_SIZE + 4),
      BOUNDARY_PROTECTED_AREA(BOUNDARY.id * ENUM_SIZE + 5),
        BOUNDARY_PROTECTED_AREA_1A(BOUNDARY_PROTECTED_AREA.id * ENUM_SIZE + 1),
        BOUNDARY_PROTECTED_AREA_1B(BOUNDARY_PROTECTED_AREA.id * ENUM_SIZE + 2),
        BOUNDARY_PROTECTED_AREA_2(BOUNDARY_PROTECTED_AREA.id * ENUM_SIZE + 3),
        BOUNDARY_PROTECTED_AREA_3(BOUNDARY_PROTECTED_AREA.id * ENUM_SIZE + 4),
        BOUNDARY_PROTECTED_AREA_4(BOUNDARY_PROTECTED_AREA.id * ENUM_SIZE + 5),
        BOUNDARY_PROTECTED_AREA_5(BOUNDARY_PROTECTED_AREA.id * ENUM_SIZE + 6),
        BOUNDARY_PROTECTED_AREA_6(BOUNDARY_PROTECTED_AREA.id * ENUM_SIZE + 7),
  ROUTE(ANY.id * ENUM_SIZE + 2),
      TRANSPORT(ROUTE.id * ENUM_SIZE + 1),
        TRANSPORT_BUS(TRANSPORT.id * ENUM_SIZE + 1),
        TRANSPORT_DETOUR(TRANSPORT.id * ENUM_SIZE + 2),
        TRANSPORT_FERRY(TRANSPORT.id * ENUM_SIZE + 3),
        TRANSPORT_LIGHT_RAIL(TRANSPORT.id * ENUM_SIZE + 4),
        TRANSPORT_RAILWAY(TRANSPORT.id * ENUM_SIZE + 5),
        TRANSPORT_ROAD(TRANSPORT.id * ENUM_SIZE + 6),
        TRANSPORT_SUBWAY(TRANSPORT.id * ENUM_SIZE + 7),
        TRANSPORT_TRAIN(TRANSPORT.id * ENUM_SIZE + 8),
        TRANSPORT_TRACKS(TRANSPORT.id * ENUM_SIZE + 9),
        TRANSPORT_TRAM(TRANSPORT.id * ENUM_SIZE + 10),
        TRANSPORT_TROLLEYBUS(TRANSPORT.id * ENUM_SIZE + 11),
      TRAIL(ROUTE.id * ENUM_SIZE + 2),
        TRAIL_BICYCLE(TRAIL.id * ENUM_SIZE + 1),
        TRAIL_CANOE(TRAIL.id * ENUM_SIZE + 2),
        TRAIL_FOOT(TRAIL.id * ENUM_SIZE + 3),
        TRAIL_HIKING(TRAIL.id * ENUM_SIZE + 4),
        TRAIL_HORSE(TRAIL.id * ENUM_SIZE + 5),
        TRAIL_INLINE_SKATES(TRAIL.id * ENUM_SIZE + 6),
        TRAIL_MTB(TRAIL.id * ENUM_SIZE + 7),
        TRAIL_PISTE(TRAIL.id * ENUM_SIZE + 8),
        TRAIL_RUNNING(TRAIL.id * ENUM_SIZE + 9),
        TRAIL_SKIING(TRAIL.id * ENUM_SIZE + 10),
  ;

  fun coerceAtLeast(minimumValue: RelationCategory?): RelationCategory {
    return if (minimumValue != null && id < minimumValue.id) {
      minimumValue
    } else {
      this
    }
  }

  fun isParentOf(category: RelationCategory): Boolean {
    return aDescendsB(category.id, id)
  }
}

enum class WayCategory(val id: Int) {
  ANY(0),
    HIGHWAY(ANY.id * ENUM_SIZE + 1),
      ROAD(HIGHWAY.id * ENUM_SIZE + 1),
        // Normal roads
        ROAD_MOTORWAY(ROAD.id * ENUM_SIZE + 1),
        ROAD_TRUNK(ROAD.id * ENUM_SIZE + 2),
        ROAD_PRIMARY(ROAD.id * ENUM_SIZE + 3),
        ROAD_SECONDARY(ROAD.id * ENUM_SIZE + 4),
        ROAD_TERTIARY(ROAD.id * ENUM_SIZE + 5),
        ROAD_UNCLASSIFIED(ROAD.id * ENUM_SIZE + 6),
        ROAD_RESIDENTIAL(ROAD.id * ENUM_SIZE + 7),

        // Link roads
        ROAD_MOTORWAY_LINK(ROAD.id * ENUM_SIZE + 8),
        ROAD_TRUNK_LINK(ROAD.id * ENUM_SIZE + 9),
        ROAD_PRIMARY_LINK(ROAD.id * ENUM_SIZE + 10),
        ROAD_SECONDARY_LINK(ROAD.id * ENUM_SIZE + 11),
        ROAD_TERTIARY_LINK(ROAD.id * ENUM_SIZE + 12),

        // Special roads
        ROAD_LIVING_STREET(ROAD.id * ENUM_SIZE + 13),
        ROAD_SERVICE(ROAD.id * ENUM_SIZE + 14),
        ROAD_PEDESTRIAN(ROAD.id * ENUM_SIZE + 15),
        ROAD_TRACK(ROAD.id * ENUM_SIZE + 16),
        ROAD_BUS_GUIDEWAY(ROAD.id * ENUM_SIZE + 17),
        ROAD_ESCAPE(ROAD.id * ENUM_SIZE + 18),
        ROAD_RACEWAY(ROAD.id * ENUM_SIZE + 19),
        ROAD_BUSWAY(ROAD.id * ENUM_SIZE + 20),

      PATH(HIGHWAY.id * ENUM_SIZE + 2),
        PATH_FOOTWAY(PATH.id * ENUM_SIZE + 1),
        PATH_BRIDLEWAY(PATH.id * ENUM_SIZE + 2),
        PATH_STEPS(PATH.id * ENUM_SIZE + 3),
        PATH_CORRIDOR(PATH.id * ENUM_SIZE + 4),

    PISTE(ANY.id * ENUM_SIZE + 2),
      PISTE_DOWNHILL(PISTE.id * ENUM_SIZE + 1),
      PISTE_NORDIC(PISTE.id * ENUM_SIZE + 2),
      PISTE_SKITOUR(PISTE.id * ENUM_SIZE + 3),
      PISTE_SLED(PISTE.id * ENUM_SIZE + 4),
      PISTE_HIKE(PISTE.id * ENUM_SIZE + 5),
      PISTE_SLEIGH(PISTE.id * ENUM_SIZE + 6),
      PISTE_ICE_SKATE(PISTE.id * ENUM_SIZE + 7),
      PISTE_SKI_JUMP(PISTE.id * ENUM_SIZE + 8),
      PISTE_CONNECTION(PISTE.id * ENUM_SIZE + 9),
  ;

  fun coerceAtLeast(minimumValue: WayCategory?): WayCategory {
    return if (minimumValue != null && id < minimumValue.id) {
      minimumValue
    } else {
      this
    }
  }

  fun isParentOf(category: WayCategory): Boolean {
    return aDescendsB(category.id, id)
  }
}

private fun aDescendsB(a: Int, b: Int): Boolean {
  var cursor = a
  while (b < cursor) {
    cursor = (cursor - 1) / ENUM_SIZE
  }
  return b == cursor
}