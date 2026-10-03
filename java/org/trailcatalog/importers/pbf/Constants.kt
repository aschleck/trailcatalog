package org.trailcatalog.importers.pbf

import com.google.common.collect.ImmutableMap
import com.google.protobuf.ByteString
import org.trailcatalog.models.PointCategory
import org.trailcatalog.models.RelationCategory
import org.trailcatalog.models.WayCategory

const val TRAIL_FROM_RELATION_OFFSET = 0
const val TRAIL_FROM_WAY_OFFSET = Long.MAX_VALUE / 2
const val NANO = .000000001

val POINT_AEROWAY_CATEGORY_NAMES = ImmutableMap.builder<ByteString, PointCategory>()
    .put(ByteString.copyFromUtf8("aerodrome"), PointCategory.ACCESS_TRANSIT_AIRPORT)

    .build()

val POINT_AMENITY_CATEGORY_NAMES = ImmutableMap.builder<ByteString, PointCategory>()
    .put(ByteString.copyFromUtf8("bbq"), PointCategory.FACILITY_FIRE_BARBECUE)
    .put(ByteString.copyFromUtf8("bicycle_repair_station"), PointCategory.FACILITY_BICYCLE_REPAIR)
    .put(ByteString.copyFromUtf8("clinic"), PointCategory.SAFETY_CLINIC)
    .put(ByteString.copyFromUtf8("drinking_water"), PointCategory.WATER_DRINKING)
    .put(ByteString.copyFromUtf8("ferry_terminal"), PointCategory.ACCESS_TRANSIT_FERRY_TERMINAL)
    .put(ByteString.copyFromUtf8("fuel"), PointCategory.RESUPPLY_FUEL)
    .put(ByteString.copyFromUtf8("parking"), PointCategory.ACCESS_PARKING)
    .put(ByteString.copyFromUtf8("pharmacy"), PointCategory.SAFETY_PHARMACY)
    .put(ByteString.copyFromUtf8("post_office"), PointCategory.RESUPPLY_POST_OFFICE)
    .put(ByteString.copyFromUtf8("ranger_station"), PointCategory.INFORMATION_RANGER_STATION)
    .put(ByteString.copyFromUtf8("shelter"), PointCategory.FACILITY_SHELTER)
    .put(ByteString.copyFromUtf8("shower"), PointCategory.FACILITY_SHOWER)
    .put(ByteString.copyFromUtf8("toilets"), PointCategory.FACILITY_TOILETS)
    .put(ByteString.copyFromUtf8("water_point"), PointCategory.WATER_POINT)

    .build()

val POINT_EMERGENCY_CATEGORY_NAMES = ImmutableMap.builder<ByteString, PointCategory>()
    .put(ByteString.copyFromUtf8("defibrillator"), PointCategory.SAFETY_DEFIBRILLATOR)
    .put(ByteString.copyFromUtf8("mountain_rescue"), PointCategory.SAFETY_MOUNTAIN_RESCUE)
    .put(ByteString.copyFromUtf8("phone"), PointCategory.SAFETY_EMERGENCY_PHONE)

    .build()

val POINT_HIGHWAY_CATEGORY_NAMES = ImmutableMap.builder<ByteString, PointCategory>()
    .put(ByteString.copyFromUtf8("bus_stop"), PointCategory.ACCESS_TRANSIT_BUS_STOP)
    .put(ByteString.copyFromUtf8("trailhead"), PointCategory.ACCESS_TRAILHEAD)

    .build()

val POINT_HISTORIC_CATEGORY_NAMES = ImmutableMap.builder<ByteString, PointCategory>()
    .put(ByteString.copyFromUtf8("ruins"), PointCategory.SIGHT_RUINS)

    .build()

val POINT_INFORMATION_CATEGORY_NAMES = ImmutableMap.builder<ByteString, PointCategory>()
    .put(ByteString.copyFromUtf8("guidepost"), PointCategory.INFORMATION_GUIDE_POST)
    .put(ByteString.copyFromUtf8("visitor_centre"), PointCategory.INFORMATION_VISITOR_CENTER)

    .build()

val POINT_LEISURE_CATEGORY_NAMES = ImmutableMap.builder<ByteString, PointCategory>()
    .put(ByteString.copyFromUtf8("firepit"), PointCategory.FACILITY_FIRE_PIT)
    .put(ByteString.copyFromUtf8("picnic_table"), PointCategory.FACILITY_PICNIC_TABLE)

    .build()

// man_made=tower is only a sight with tower:type=observation, so ExtractPoints handles it.
val POINT_MAN_MADE_CATEGORY_NAMES = ImmutableMap.builder<ByteString, PointCategory>()
    .put(ByteString.copyFromUtf8("water_tap"), PointCategory.WATER_TAP)

    .build()

val POINT_MOUNTAIN_PASS_CATEGORY_NAMES = ImmutableMap.builder<ByteString, PointCategory>()
    .put(ByteString.copyFromUtf8("yes"), PointCategory.NATURAL_MOUNTAIN_PASS)

    .build()

val POINT_NATURAL_CATEGORY_NAMES = ImmutableMap.builder<ByteString, PointCategory>()
    .put(ByteString.copyFromUtf8("cave_entrance"), PointCategory.NATURAL_CAVE_ENTRANCE)
    .put(ByteString.copyFromUtf8("hot_spring"), PointCategory.NATURAL_HOT_SPRING)
    .put(ByteString.copyFromUtf8("peak"), PointCategory.NATURAL_PEAK)
    .put(ByteString.copyFromUtf8("saddle"), PointCategory.NATURAL_SADDLE)
    .put(ByteString.copyFromUtf8("spring"), PointCategory.WATER_SPRING)
    .put(ByteString.copyFromUtf8("volcano"), PointCategory.NATURAL_VOLCANO)

    .build()

val POINT_RAILWAY_CATEGORY_NAMES = ImmutableMap.builder<ByteString, PointCategory>()
    .put(ByteString.copyFromUtf8("halt"), PointCategory.ACCESS_TRANSIT_STATION)
    .put(ByteString.copyFromUtf8("station"), PointCategory.ACCESS_TRANSIT_STATION)

    .build()

val POINT_SHOP_CATEGORY_NAMES = ImmutableMap.builder<ByteString, PointCategory>()
    .put(ByteString.copyFromUtf8("convenience"), PointCategory.RESUPPLY_CONVENIENCE)
    .put(ByteString.copyFromUtf8("laundry"), PointCategory.FACILITY_LAUNDRY)
    .put(ByteString.copyFromUtf8("outdoor"), PointCategory.RESUPPLY_OUTDOOR)
    .put(ByteString.copyFromUtf8("supermarket"), PointCategory.RESUPPLY_SUPERMARKET)

    .build()

val POINT_TOURISM_CATEGORY_NAMES = ImmutableMap.builder<ByteString, PointCategory>()
    .put(ByteString.copyFromUtf8("alpine_hut"), PointCategory.LODGING_HUT_ALPINE)
    .put(ByteString.copyFromUtf8("camp_pitch"), PointCategory.LODGING_CAMP_PITCH)
    .put(ByteString.copyFromUtf8("camp_site"), PointCategory.LODGING_CAMP_SITE)
    .put(ByteString.copyFromUtf8("caravan_site"), PointCategory.LODGING_CAMP_CARAVAN_SITE)
    .put(ByteString.copyFromUtf8("chalet"), PointCategory.LODGING_ROOM_CHALET)
    .put(ByteString.copyFromUtf8("guest_house"), PointCategory.LODGING_ROOM_GUEST_HOUSE)
    .put(ByteString.copyFromUtf8("hostel"), PointCategory.LODGING_HOSTEL)
    .put(ByteString.copyFromUtf8("hotel"), PointCategory.LODGING_ROOM_HOTEL)
    .put(ByteString.copyFromUtf8("motel"), PointCategory.LODGING_ROOM_MOTEL)
    .put(ByteString.copyFromUtf8("picnic_site"), PointCategory.FACILITY_PICNIC_SITE)
    .put(ByteString.copyFromUtf8("viewpoint"), PointCategory.SIGHT_VIEWPOINT)
    .put(ByteString.copyFromUtf8("wilderness_hut"), PointCategory.LODGING_HUT_WILDERNESS)

    .build()

val POINT_WATERWAY_CATEGORY_NAMES = ImmutableMap.builder<ByteString, PointCategory>()
    .put(ByteString.copyFromUtf8("waterfall"), PointCategory.NATURAL_WATERFALL)

    .build()

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

val AERIALWAY_CATEGORY_NAMES = ImmutableMap.builder<ByteString, WayCategory>()
    .put(ByteString.copyFromUtf8("cable_car"), WayCategory.AERIALWAY_CABLE_CAR)
    .put(ByteString.copyFromUtf8("gondola"), WayCategory.AERIALWAY_GONDOLA)
    .put(ByteString.copyFromUtf8("mixed_lift"), WayCategory.AERIALWAY_MIXED_LIFT)
    .put(ByteString.copyFromUtf8("chair_lift"), WayCategory.AERIALWAY_CHAIR_LIFT)
    .put(ByteString.copyFromUtf8("drag_lift"), WayCategory.AERIALWAY_DRAG_LIFT)
    .put(ByteString.copyFromUtf8("t-bar"), WayCategory.AERIALWAY_T_BAR)
    .put(ByteString.copyFromUtf8("j-bar"), WayCategory.AERIALWAY_J_BAR)
    .put(ByteString.copyFromUtf8("platter"), WayCategory.AERIALWAY_PLATTER)
    .put(ByteString.copyFromUtf8("rope_tow"), WayCategory.AERIALWAY_ROPE_TOW)
    .put(ByteString.copyFromUtf8("magic_carpet"), WayCategory.AERIALWAY_MAGIC_CARPET)
    .put(ByteString.copyFromUtf8("zip_line"), WayCategory.AERIALWAY_ZIP_LINE)
    .put(ByteString.copyFromUtf8("goods"), WayCategory.AERIALWAY_GOODS)

    .build()

val AEROWAY_CATEGORY_NAMES = ImmutableMap.builder<ByteString, WayCategory>()
    .put(ByteString.copyFromUtf8("runway"), WayCategory.AEROWAY_RUNWAY)
    .put(ByteString.copyFromUtf8("taxiway"), WayCategory.AEROWAY_TAXIWAY)
    .put(ByteString.copyFromUtf8("taxilane"), WayCategory.AEROWAY_TAXILANE)
    .put(ByteString.copyFromUtf8("helipad"), WayCategory.AEROWAY_HELIPAD)
    .put(ByteString.copyFromUtf8("apron"), WayCategory.AEROWAY_APRON)
    .put(ByteString.copyFromUtf8("aerodrome"), WayCategory.AEROWAY_AERODROME)

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
    .put(ByteString.copyFromUtf8("cycleway"), WayCategory.PATH_CYCLEWAY)
    .put(ByteString.copyFromUtf8("footway"), WayCategory.PATH_FOOTWAY)
    .put(ByteString.copyFromUtf8("bridleway"), WayCategory.PATH_BRIDLEWAY)
    .put(ByteString.copyFromUtf8("steps"), WayCategory.PATH_STEPS)
    .put(ByteString.copyFromUtf8("corridor"), WayCategory.PATH_CORRIDOR)

    .put(ByteString.copyFromUtf8("construction"), WayCategory.ROAD_CONSTRUCTION)

    .build()

// What a highway=footway is for, from footway=*. Everything else, including no footway tag at all,
// stays on PATH_FOOTWAY, which is where a trail someone tagged highway=footway lands.
val FOOTWAY_CATEGORY_NAMES = ImmutableMap.builder<ByteString, WayCategory>()
    .put(ByteString.copyFromUtf8("sidewalk"), WayCategory.PATH_FOOTWAY_SIDEWALK)
    .put(ByteString.copyFromUtf8("crossing"), WayCategory.PATH_FOOTWAY_CROSSING)

    .build()

val MAN_MADE_CATEGORY_NAMES = ImmutableMap.builder<ByteString, WayCategory>()
    .put(ByteString.copyFromUtf8("pier"), WayCategory.MAN_MADE_PIER)
    .put(ByteString.copyFromUtf8("breakwater"), WayCategory.MAN_MADE_BREAKWATER)
    .put(ByteString.copyFromUtf8("groyne"), WayCategory.MAN_MADE_GROYNE)

    .build()

val NATURAL_WAY_CATEGORY_NAMES = ImmutableMap.builder<ByteString, WayCategory>()
    .put(ByteString.copyFromUtf8("coastline"), WayCategory.NATURAL_COASTLINE)
    .put(ByteString.copyFromUtf8("tree_row"), WayCategory.NATURAL_TREE_ROW)
    .put(ByteString.copyFromUtf8("cliff"), WayCategory.NATURAL_CLIFF)
    .put(ByteString.copyFromUtf8("ridge"), WayCategory.NATURAL_RIDGE)
    .put(ByteString.copyFromUtf8("arete"), WayCategory.NATURAL_ARETE)
    .put(ByteString.copyFromUtf8("valley"), WayCategory.NATURAL_VALLEY)

    .build()

val RAILWAY_CATEGORY_NAMES = ImmutableMap.builder<ByteString, WayCategory>()
    .put(ByteString.copyFromUtf8("rail"), WayCategory.RAIL)
    .put(ByteString.copyFromUtf8("narrow_gauge"), WayCategory.RAIL_NARROW_GAUGE)
    .put(ByteString.copyFromUtf8("preserved"), WayCategory.RAIL_PRESERVED)
    .put(ByteString.copyFromUtf8("funicular"), WayCategory.RAIL_FUNICULAR)

    .put(ByteString.copyFromUtf8("subway"), WayCategory.RAIL_SUBWAY)
    .put(ByteString.copyFromUtf8("light_rail"), WayCategory.RAIL_LIGHT_RAIL)
    .put(ByteString.copyFromUtf8("tram"), WayCategory.RAIL_TRAM)
    .put(ByteString.copyFromUtf8("monorail"), WayCategory.RAIL_MONORAIL)

    .build()

// The class a highway=construction way is being built into, from construction=*.
val ROAD_CONSTRUCTION_CATEGORY_NAMES = ImmutableMap.builder<ByteString, WayCategory>()
    .put(ByteString.copyFromUtf8("motorway"), WayCategory.ROAD_CONSTRUCTION_MOTORWAY)
    .put(ByteString.copyFromUtf8("motorway_link"), WayCategory.ROAD_CONSTRUCTION_MOTORWAY)
    .put(ByteString.copyFromUtf8("trunk"), WayCategory.ROAD_CONSTRUCTION_TRUNK)
    .put(ByteString.copyFromUtf8("trunk_link"), WayCategory.ROAD_CONSTRUCTION_TRUNK)
    .put(ByteString.copyFromUtf8("primary"), WayCategory.ROAD_CONSTRUCTION_PRIMARY)
    .put(ByteString.copyFromUtf8("primary_link"), WayCategory.ROAD_CONSTRUCTION_PRIMARY)
    .put(ByteString.copyFromUtf8("secondary"), WayCategory.ROAD_CONSTRUCTION_SECONDARY)
    .put(ByteString.copyFromUtf8("secondary_link"), WayCategory.ROAD_CONSTRUCTION_SECONDARY)
    .put(ByteString.copyFromUtf8("tertiary"), WayCategory.ROAD_CONSTRUCTION_TERTIARY)
    .put(ByteString.copyFromUtf8("tertiary_link"), WayCategory.ROAD_CONSTRUCTION_TERTIARY)
    .put(ByteString.copyFromUtf8("unclassified"), WayCategory.ROAD_CONSTRUCTION_MINOR)
    .put(ByteString.copyFromUtf8("residential"), WayCategory.ROAD_CONSTRUCTION_MINOR)
    .put(ByteString.copyFromUtf8("living_street"), WayCategory.ROAD_CONSTRUCTION_MINOR)

    .build()

// service=* also rides on highway=service, so only a way already known to be rail may take these.
val RAIL_SERVICE_CATEGORY_NAMES = ImmutableMap.builder<ByteString, WayCategory>()
    .put(ByteString.copyFromUtf8("yard"), WayCategory.RAIL_YARD)
    .put(ByteString.copyFromUtf8("siding"), WayCategory.RAIL_SIDING)
    .put(ByteString.copyFromUtf8("spur"), WayCategory.RAIL_SPUR)

    .build()

val WATERWAY_CATEGORY_NAMES = ImmutableMap.builder<ByteString, WayCategory>()
    .put(ByteString.copyFromUtf8("river"), WayCategory.WATERWAY_RIVER)
    .put(ByteString.copyFromUtf8("stream"), WayCategory.WATERWAY_STREAM)
    .put(ByteString.copyFromUtf8("canal"), WayCategory.WATERWAY_CANAL)
    .put(ByteString.copyFromUtf8("ditch"), WayCategory.WATERWAY_DITCH)
    .put(ByteString.copyFromUtf8("drain"), WayCategory.WATERWAY_DRAIN)

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

    .put(ByteString.copyFromUtf8("bicycle"), RelationCategory.TRAIL_BICYCLE)
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

val ROUTE_WAY_CATEGORY_NAMES = ImmutableMap.builder<ByteString, WayCategory>()
    .put(ByteString.copyFromUtf8("ferry"), WayCategory.WATERWAY_FERRY)
    .put(ByteString.copyFromUtf8("piste"), WayCategory.PISTE)

    .build()

// Tag keys that hold a name, either bare or suffixed with a language.
// https://wiki.openstreetmap.org/wiki/Names
val NAME_TAG_KEYS =
    listOf(
        "alt_name",
        "int_name",
        "loc_name",
        "name",
        "nat_name",
        "official_name",
        "old_name",
        "reg_name",
        "short_name",
    ).map { ByteString.copyFromUtf8(it) }

val ADMIN_LEVEL_BS = ByteString.copyFromUtf8("admin_level")
val AERIALWAY_BS = ByteString.copyFromUtf8("aerialway")
val AEROWAY_BS = ByteString.copyFromUtf8("aeroway")
val AMENITY_BS = ByteString.copyFromUtf8("amenity")
val BOUNDARY_BS = ByteString.copyFromUtf8("boundary")
val CONSTRUCTION_BS = ByteString.copyFromUtf8("construction")
val EMERGENCY_BS = ByteString.copyFromUtf8("emergency")
val FOOTWAY_BS = ByteString.copyFromUtf8("footway")
val HIGHWAY_BS = ByteString.copyFromUtf8("highway")
val HISTORIC_BS = ByteString.copyFromUtf8("historic")
val INFORMATION_BS = ByteString.copyFromUtf8("information")
val LEISURE_BS = ByteString.copyFromUtf8("leisure")
val MAN_MADE_BS = ByteString.copyFromUtf8("man_made")
val MOUNTAIN_PASS_BS = ByteString.copyFromUtf8("mountain_pass")
val IATA_BS = ByteString.copyFromUtf8("iata")
val ICAO_BS = ByteString.copyFromUtf8("icao")
val NAME_BS = ByteString.copyFromUtf8("name")
val NATURAL_BS = ByteString.copyFromUtf8("natural")
val OBSERVATION_BS = ByteString.copyFromUtf8("observation")
val PISTE_TYPE_BS = ByteString.copyFromUtf8("piste:type")
val PROTECT_CLASS_BS = ByteString.copyFromUtf8("protect_class")
val RAILWAY_BS = ByteString.copyFromUtf8("railway")
val ROUTE_BS = ByteString.copyFromUtf8("route")
val SERVICE_BS = ByteString.copyFromUtf8("service")
val SHOP_BS = ByteString.copyFromUtf8("shop")
val TOURISM_BS = ByteString.copyFromUtf8("tourism")
val TOWER_BS = ByteString.copyFromUtf8("tower")
val TOWER_TYPE_BS = ByteString.copyFromUtf8("tower:type")
val WATERWAY_BS = ByteString.copyFromUtf8("waterway")
val WIKIDATA_BS = ByteString.copyFromUtf8("wikidata")
val WIKIPEDIA_BS = ByteString.copyFromUtf8("wikipedia")
// Articles in other languages, like wikipedia:de
val WIKIPEDIA_PREFIX_BS = ByteString.copyFromUtf8("wikipedia:")
