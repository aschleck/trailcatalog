package org.trailcatalog.pbf

import com.google.common.collect.ImmutableMap
import com.google.protobuf.ByteString

val HEX_CHARACTERS = "0123456789abcdef".toCharArray()
const val TRAIL_FROM_RELATION_OFFSET = 0
const val TRAIL_FROM_WAY_OFFSET = Long.MAX_VALUE / 2
const val NANO = .000000001

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

val PATHS_TO_TRAILS = ImmutableMap.builder<WayCategory, RelationCategory>()
    .put(WayCategory.PATH, RelationCategory.TRAIL)
    .put(WayCategory.PATH_FOOTWAY, RelationCategory.TRAIL_FOOT)
    .put(WayCategory.PATH_BRIDLEWAY, RelationCategory.TRAIL_HORSE)
    .build()

val ADMINISTRATIVE_LEVEL_NAMES = ImmutableMap.builder<ByteString, RelationCategory>()
    .put(ByteString.copyFromUtf8("1"), RelationCategory.BOUNDARY_ADMINISTRATIVE_1)
    .put(ByteString.copyFromUtf8("2"), RelationCategory.BOUNDARY_ADMINISTRATIVE_2)
    .put(ByteString.copyFromUtf8("3"), RelationCategory.BOUNDARY_ADMINISTRATIVE_3)
    .put(ByteString.copyFromUtf8("4"), RelationCategory.BOUNDARY_ADMINISTRATIVE_4)
    .put(ByteString.copyFromUtf8("5"), RelationCategory.BOUNDARY_ADMINISTRATIVE_5)
    .put(ByteString.copyFromUtf8("6"), RelationCategory.BOUNDARY_ADMINISTRATIVE_6)
    .put(ByteString.copyFromUtf8("7"), RelationCategory.BOUNDARY_ADMINISTRATIVE_7)
    .put(ByteString.copyFromUtf8("8"), RelationCategory.BOUNDARY_ADMINISTRATIVE_8)
    .put(ByteString.copyFromUtf8("9"), RelationCategory.BOUNDARY_ADMINISTRATIVE_9)
    .put(ByteString.copyFromUtf8("10"), RelationCategory.BOUNDARY_ADMINISTRATIVE_10)
    .put(ByteString.copyFromUtf8("11"), RelationCategory.BOUNDARY_ADMINISTRATIVE_11)

    .build()

val BOUNDARY_CATEGORY_NAMES = ImmutableMap.builder<ByteString, RelationCategory>()
    .put(ByteString.copyFromUtf8("aboriginal_lands"), RelationCategory.BOUNDARY_ABORIGINAL_LANDS)
    .put(ByteString.copyFromUtf8("administrative"), RelationCategory.BOUNDARY_ADMINISTRATIVE)
    .put(ByteString.copyFromUtf8("forest"), RelationCategory.BOUNDARY_FOREST)
    .put(ByteString.copyFromUtf8("national_park"), RelationCategory.BOUNDARY_NATIONAL_PARK)
    .put(ByteString.copyFromUtf8("protected_area"), RelationCategory.BOUNDARY_PROTECTED_AREA)

    .build()

val HIGHWAY_CATEGORY_NAMES = ImmutableMap.builder<ByteString, WayCategory>()
    .put(ByteString.copyFromUtf8("road"), WayCategory.ROAD)
    .put(ByteString.copyFromUtf8("motorway"), WayCategory.ROAD_MOTORWAY)
    .put(ByteString.copyFromUtf8("trunk"), WayCategory.ROAD_TRUNK)
    .put(ByteString.copyFromUtf8("primary"), WayCategory.ROAD_PRIMARY)
    .put(ByteString.copyFromUtf8("secondary"), WayCategory.ROAD_SECONDARY)
    .put(ByteString.copyFromUtf8("tertiary"), WayCategory.ROAD_TERTIARY)
    .put(ByteString.copyFromUtf8("unclassified"), WayCategory.ROAD_UNCLASSIFIED)
    .put(ByteString.copyFromUtf8("residential"), WayCategory.ROAD_RESIDENTIAL)

    .put(ByteString.copyFromUtf8("motorway_link"), WayCategory.ROAD_MOTORWAY_LINK)
    .put(ByteString.copyFromUtf8("trunk_link"), WayCategory.ROAD_TRUNK_LINK)
    .put(ByteString.copyFromUtf8("primary_link"), WayCategory.ROAD_PRIMARY_LINK)
    .put(ByteString.copyFromUtf8("secondary_link"), WayCategory.ROAD_SECONDARY_LINK)
    .put(ByteString.copyFromUtf8("tertiary_link"), WayCategory.ROAD_TERTIARY_LINK)

    .put(ByteString.copyFromUtf8("living_street"), WayCategory.ROAD_LIVING_STREET)
    .put(ByteString.copyFromUtf8("service"), WayCategory.ROAD_SERVICE)
    .put(ByteString.copyFromUtf8("pedestrian"), WayCategory.ROAD_PEDESTRIAN)
    .put(ByteString.copyFromUtf8("track"), WayCategory.ROAD_TRACK)
    .put(ByteString.copyFromUtf8("bus_guideway"), WayCategory.ROAD_BUS_GUIDEWAY)
    .put(ByteString.copyFromUtf8("escape"), WayCategory.ROAD_ESCAPE)
    .put(ByteString.copyFromUtf8("raceway"), WayCategory.ROAD_RACEWAY)
    .put(ByteString.copyFromUtf8("busway"), WayCategory.ROAD_BUSWAY)

    .put(ByteString.copyFromUtf8("path"), WayCategory.PATH)
    .put(ByteString.copyFromUtf8("footway"), WayCategory.PATH_FOOTWAY)
    .put(ByteString.copyFromUtf8("bridleway"), WayCategory.PATH_BRIDLEWAY)
    .put(ByteString.copyFromUtf8("steps"), WayCategory.PATH_STEPS)
    .put(ByteString.copyFromUtf8("corridor"), WayCategory.PATH_CORRIDOR)

    .build()

val PROTECT_CLASS_NAMES = ImmutableMap.builder<ByteString, RelationCategory>()
    .put(ByteString.copyFromUtf8("1"), RelationCategory.BOUNDARY_PROTECTED_AREA_1B)
    .put(ByteString.copyFromUtf8("1a"), RelationCategory.BOUNDARY_PROTECTED_AREA_1A)
    .put(ByteString.copyFromUtf8("1b"), RelationCategory.BOUNDARY_PROTECTED_AREA_1B)
    .put(ByteString.copyFromUtf8("2"), RelationCategory.BOUNDARY_PROTECTED_AREA_2)
    .put(ByteString.copyFromUtf8("3"), RelationCategory.BOUNDARY_PROTECTED_AREA_3)
    .put(ByteString.copyFromUtf8("4"), RelationCategory.BOUNDARY_PROTECTED_AREA_4)
    .put(ByteString.copyFromUtf8("5"), RelationCategory.BOUNDARY_PROTECTED_AREA_5)
    .put(ByteString.copyFromUtf8("6"), RelationCategory.BOUNDARY_PROTECTED_AREA_6)

    .build()

val ROUTE_CATEGORY_NAMES = ImmutableMap.builder<ByteString, RelationCategory>()
    .put(ByteString.copyFromUtf8("bus"), RelationCategory.TRANSPORT_BUS)
    .put(ByteString.copyFromUtf8("detour"), RelationCategory.TRANSPORT_DETOUR)
    .put(ByteString.copyFromUtf8("ferry"), RelationCategory.TRANSPORT_FERRY)
    .put(ByteString.copyFromUtf8("light_rail"), RelationCategory.TRANSPORT_LIGHT_RAIL)
    .put(ByteString.copyFromUtf8("railway"), RelationCategory.TRANSPORT_RAILWAY)
    .put(ByteString.copyFromUtf8("road"), RelationCategory.TRANSPORT_ROAD)
    .put(ByteString.copyFromUtf8("subway"), RelationCategory.TRANSPORT_SUBWAY)
    .put(ByteString.copyFromUtf8("train"), RelationCategory.TRANSPORT_TRAIN)
    .put(ByteString.copyFromUtf8("tracks"), RelationCategory.TRANSPORT_TRACKS)
    .put(ByteString.copyFromUtf8("tram"), RelationCategory.TRANSPORT_TRAM)
    .put(ByteString.copyFromUtf8("trolleybus"), RelationCategory.TRANSPORT_TROLLEYBUS)

    .put(ByteString.copyFromUtf8("biycle"), RelationCategory.TRAIL_BICYCLE)
    .put(ByteString.copyFromUtf8("canoe"), RelationCategory.TRAIL_CANOE)
    .put(ByteString.copyFromUtf8("foot"), RelationCategory.TRAIL_FOOT)
    .put(ByteString.copyFromUtf8("hiking"), RelationCategory.TRAIL_HIKING)
    .put(ByteString.copyFromUtf8("horse"), RelationCategory.TRAIL_HORSE)
    .put(ByteString.copyFromUtf8("inline_skates"), RelationCategory.TRAIL_INLINE_SKATES)
    .put(ByteString.copyFromUtf8("mtb"), RelationCategory.TRAIL_MTB)
    .put(ByteString.copyFromUtf8("piste"), RelationCategory.TRAIL_PISTE)
    .put(ByteString.copyFromUtf8("running"), RelationCategory.TRAIL_RUNNING)
    .put(ByteString.copyFromUtf8("skiing"), RelationCategory.TRAIL_SKIING)

    .build()

val ADMIN_LEVEL_BS = ByteString.copyFromUtf8("admin_level")
val BOUNDARY_BS = ByteString.copyFromUtf8("boundary")
val HIGHWAY_BS = ByteString.copyFromUtf8("highway")
val NAME_BS = ByteString.copyFromUtf8("name")
val NETWORK_BS = ByteString.copyFromUtf8("network")
val PROTECT_CLASS_BS = ByteString.copyFromUtf8("protect_class")
val REF_BS = ByteString.copyFromUtf8("ref")
val ROUTE_BS = ByteString.copyFromUtf8("route")