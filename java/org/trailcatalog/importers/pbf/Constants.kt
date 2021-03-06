package org.trailcatalog.importers.pbf

import com.google.common.collect.ImmutableMap
import com.google.protobuf.ByteString
import org.trailcatalog.models.RelationCategory
import org.trailcatalog.models.WayCategory

const val TRAIL_FROM_RELATION_OFFSET = 0
const val TRAIL_FROM_WAY_OFFSET = Long.MAX_VALUE / 2
const val NANO = .000000001

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

val PISTE_CATEGORY_NAMES = ImmutableMap.builder<ByteString, WayCategory>()
    .put(ByteString.copyFromUtf8("downhill"), WayCategory.PISTE_DOWNHILL)
    .put(ByteString.copyFromUtf8("nordic"), WayCategory.PISTE_NORDIC)
    .put(ByteString.copyFromUtf8("skitour"), WayCategory.PISTE_SKITOUR)
    .put(ByteString.copyFromUtf8("sled"), WayCategory.PISTE_SLED)
    .put(ByteString.copyFromUtf8("hike"), WayCategory.PISTE_HIKE)
    .put(ByteString.copyFromUtf8("sleigh"), WayCategory.PISTE_SLEIGH)
    .put(ByteString.copyFromUtf8("ice_skate"), WayCategory.PISTE_ICE_SKATE)
    .put(ByteString.copyFromUtf8("ski_jump"), WayCategory.PISTE_SKI_JUMP)
    .put(ByteString.copyFromUtf8("connection"), WayCategory.PISTE_CONNECTION)

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
val PISTE_TYPE_BS = ByteString.copyFromUtf8("piste:type")
val PROTECT_CLASS_BS = ByteString.copyFromUtf8("protect_class")
val REF_BS = ByteString.copyFromUtf8("ref")
val ROUTE_BS = ByteString.copyFromUtf8("route")