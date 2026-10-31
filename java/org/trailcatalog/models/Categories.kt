package org.trailcatalog.models

// Enum scheme: each enum can have `ENUM_SIZE` children, ranging from id
// parent.id * ENUM_SIZE + 1 to parent.id * ENUM_SIZE + ENUM_SIZE.
const val ENUM_SIZE = 64

interface Category<T : Category<T>> {

  val id: Int

  fun coerceAtLeast(minimumValue: T?): T {
    return if (minimumValue != null && id < minimumValue.id) {
      minimumValue
    } else {
      this as T
    }
  }

  fun isParentOf(other: Int): Boolean {
    return aDescendsB(other, id)
  }

  fun isParentOf(category: T): Boolean {
    return aDescendsB(category.id, id)
  }
}

// Groups run from town to trail, because coerceAtLeast keeps the larger id when a node matches more
// than one category, so at a given depth a later group wins.
enum class PointCategory(override val id: Int) : Category<PointCategory> {
  ANY(0),
    RESUPPLY(ANY.id * ENUM_SIZE + 1),
      RESUPPLY_CONVENIENCE(RESUPPLY.id * ENUM_SIZE + 1),
      RESUPPLY_FUEL(RESUPPLY.id * ENUM_SIZE + 2),
      RESUPPLY_OUTDOOR(RESUPPLY.id * ENUM_SIZE + 3),
      RESUPPLY_POST_OFFICE(RESUPPLY.id * ENUM_SIZE + 4),
      RESUPPLY_SUPERMARKET(RESUPPLY.id * ENUM_SIZE + 5),
    SAFETY(ANY.id * ENUM_SIZE + 2),
      SAFETY_CLINIC(SAFETY.id * ENUM_SIZE + 1),
      SAFETY_DEFIBRILLATOR(SAFETY.id * ENUM_SIZE + 2),
      SAFETY_EMERGENCY_PHONE(SAFETY.id * ENUM_SIZE + 3),
      SAFETY_MOUNTAIN_RESCUE(SAFETY.id * ENUM_SIZE + 4),
      SAFETY_PHARMACY(SAFETY.id * ENUM_SIZE + 5),
    LODGING(ANY.id * ENUM_SIZE + 3),
      LODGING_CAMP(LODGING.id * ENUM_SIZE + 1),
        LODGING_CAMP_PITCH(LODGING_CAMP.id * ENUM_SIZE + 1),
        LODGING_CAMP_SITE(LODGING_CAMP.id * ENUM_SIZE + 2),
        LODGING_CAMP_CARAVAN_SITE(LODGING_CAMP.id * ENUM_SIZE + 3),
      LODGING_HUT(LODGING.id * ENUM_SIZE + 2),
        LODGING_HUT_ALPINE(LODGING_HUT.id * ENUM_SIZE + 1),
        LODGING_HUT_WILDERNESS(LODGING_HUT.id * ENUM_SIZE + 2),
      LODGING_HOSTEL(LODGING.id * ENUM_SIZE + 3),
      // A private room or cabin by the night, where OSM's distinctions are mostly about size.
      LODGING_ROOM(LODGING.id * ENUM_SIZE + 4),
        LODGING_ROOM_CHALET(LODGING_ROOM.id * ENUM_SIZE + 1),
        LODGING_ROOM_GUEST_HOUSE(LODGING_ROOM.id * ENUM_SIZE + 2),
        LODGING_ROOM_HOTEL(LODGING_ROOM.id * ENUM_SIZE + 3),
        LODGING_ROOM_MOTEL(LODGING_ROOM.id * ENUM_SIZE + 4),
    FACILITY(ANY.id * ENUM_SIZE + 4),
      FACILITY_FIRE(FACILITY.id * ENUM_SIZE + 1),
        FACILITY_FIRE_BARBECUE(FACILITY_FIRE.id * ENUM_SIZE + 1),
        FACILITY_FIRE_PIT(FACILITY_FIRE.id * ENUM_SIZE + 2),
      FACILITY_PICNIC(FACILITY.id * ENUM_SIZE + 2),
        FACILITY_PICNIC_SITE(FACILITY_PICNIC.id * ENUM_SIZE + 1),
        FACILITY_PICNIC_TABLE(FACILITY_PICNIC.id * ENUM_SIZE + 2),
      FACILITY_BICYCLE_REPAIR(FACILITY.id * ENUM_SIZE + 3),
      FACILITY_LAUNDRY(FACILITY.id * ENUM_SIZE + 4),
      FACILITY_SHELTER(FACILITY.id * ENUM_SIZE + 5),
      FACILITY_SHOWER(FACILITY.id * ENUM_SIZE + 6),
      FACILITY_TOILETS(FACILITY.id * ENUM_SIZE + 7),
    WATER(ANY.id * ENUM_SIZE + 5),
      WATER_DRINKING(WATER.id * ENUM_SIZE + 1),
      WATER_POINT(WATER.id * ENUM_SIZE + 2),
      WATER_SPRING(WATER.id * ENUM_SIZE + 3),
      WATER_TAP(WATER.id * ENUM_SIZE + 4),
    INFORMATION(ANY.id * ENUM_SIZE + 6),
      INFORMATION_GUIDE_POST(INFORMATION.id * ENUM_SIZE + 1),
      INFORMATION_RANGER_STATION(INFORMATION.id * ENUM_SIZE + 2),
      INFORMATION_VISITOR_CENTER(INFORMATION.id * ENUM_SIZE + 3),
    SIGHT(ANY.id * ENUM_SIZE + 7),
      SIGHT_OBSERVATION_TOWER(SIGHT.id * ENUM_SIZE + 1),
      SIGHT_RUINS(SIGHT.id * ENUM_SIZE + 2),
      SIGHT_VIEWPOINT(SIGHT.id * ENUM_SIZE + 3),
    NATURAL(ANY.id * ENUM_SIZE + 8),
      NATURAL_CAVE_ENTRANCE(NATURAL.id * ENUM_SIZE + 1),
      NATURAL_HOT_SPRING(NATURAL.id * ENUM_SIZE + 2),
      NATURAL_PEAK(NATURAL.id * ENUM_SIZE + 3),
      NATURAL_SADDLE(NATURAL.id * ENUM_SIZE + 4),
      // After the saddle because a pass is usually also tagged as one.
      NATURAL_MOUNTAIN_PASS(NATURAL.id * ENUM_SIZE + 5),
      NATURAL_VOLCANO(NATURAL.id * ENUM_SIZE + 6),
      NATURAL_WATERFALL(NATURAL.id * ENUM_SIZE + 7),
      // Areas, which become a point inside them so their names can be searched and labeled
      NATURAL_GLACIER(NATURAL.id * ENUM_SIZE + 8),
      NATURAL_LAKE(NATURAL.id * ENUM_SIZE + 9),
      NATURAL_BAY(NATURAL.id * ENUM_SIZE + 10),
      NATURAL_STRAIT(NATURAL.id * ENUM_SIZE + 11),
    ACCESS(ANY.id * ENUM_SIZE + 9),
      ACCESS_PARKING(ACCESS.id * ENUM_SIZE + 1),
      ACCESS_TRAILHEAD(ACCESS.id * ENUM_SIZE + 2),
      ACCESS_TRANSIT(ACCESS.id * ENUM_SIZE + 3),
        ACCESS_TRANSIT_BUS_STOP(ACCESS_TRANSIT.id * ENUM_SIZE + 1),
        ACCESS_TRANSIT_FERRY_TERMINAL(ACCESS_TRANSIT.id * ENUM_SIZE + 2),
        ACCESS_TRANSIT_STATION(ACCESS_TRANSIT.id * ENUM_SIZE + 3),
        ACCESS_TRANSIT_AIRPORT(ACCESS_TRANSIT.id * ENUM_SIZE + 4),
    CLIMBING(ANY.id * ENUM_SIZE + 10),
      CLIMBING_ROUTE(CLIMBING.id * ENUM_SIZE + 1),
}

enum class RelationCategory(override val id: Int) : Category<RelationCategory> {
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
      BOUNDARY_CLIMBING(BOUNDARY.id * ENUM_SIZE + 6),
        BOUNDARY_CLIMBING_AREA(BOUNDARY_CLIMBING.id * ENUM_SIZE + 1),
        BOUNDARY_CLIMBING_BOULDER(BOUNDARY_CLIMBING.id * ENUM_SIZE + 2),
        BOUNDARY_CLIMBING_CRAG(BOUNDARY_CLIMBING.id * ENUM_SIZE + 3),
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
  // Multipolygons that only become points, see CreateRelationPoints
  NATURAL(ANY.id * ENUM_SIZE + 3),
    NATURAL_GLACIER(NATURAL.id * ENUM_SIZE + 1),
    NATURAL_LAKE(NATURAL.id * ENUM_SIZE + 2),
    NATURAL_BAY(NATURAL.id * ENUM_SIZE + 3),
    NATURAL_STRAIT(NATURAL.id * ENUM_SIZE + 4),
  ;
}

// The areas a named multipolygon becomes a point for, see CreateRelationPoints. Most ponds and
// snowfields have no name, and an area is only worth a point when it has one to search and label.
val AREA_RELATION_CATEGORIES =
    mapOf(
        PointCategory.NATURAL_BAY to RelationCategory.NATURAL_BAY,
        PointCategory.NATURAL_GLACIER to RelationCategory.NATURAL_GLACIER,
        PointCategory.NATURAL_LAKE to RelationCategory.NATURAL_LAKE,
        PointCategory.NATURAL_STRAIT to RelationCategory.NATURAL_STRAIT,
    )

// The categories whose names are worth searching, and the only ones a way becomes a point for,
// with what search calls them. Bus stops, convenience stores, supermarkets, fuel, and pharmacies
// are mostly chains or street names, guide posts, parking, ruins, toilets, and camp pitches are
// mostly numbers or descriptions, and shelters are mostly bus stops and picnic roofs.
val SEARCHABLE_POINT_LABELS =
    mapOf(
        PointCategory.ACCESS_TRAILHEAD to "Trailhead",
        PointCategory.ACCESS_TRANSIT_AIRPORT to "Airport",
        PointCategory.ACCESS_TRANSIT_FERRY_TERMINAL to "Ferry terminal",
        PointCategory.ACCESS_TRANSIT_STATION to "Station",
        PointCategory.CLIMBING_ROUTE to "Climbing route",
        PointCategory.INFORMATION_RANGER_STATION to "Ranger station",
        PointCategory.INFORMATION_VISITOR_CENTER to "Visitor center",
        PointCategory.LODGING_CAMP_CARAVAN_SITE to "Caravan site",
        PointCategory.LODGING_CAMP_SITE to "Campground",
        PointCategory.LODGING_HOSTEL to "Hostel",
        PointCategory.LODGING_HUT_ALPINE to "Alpine hut",
        PointCategory.LODGING_HUT_WILDERNESS to "Wilderness hut",
        PointCategory.LODGING_ROOM_CHALET to "Chalet",
        PointCategory.LODGING_ROOM_GUEST_HOUSE to "Guest house",
        PointCategory.LODGING_ROOM_HOTEL to "Hotel",
        PointCategory.LODGING_ROOM_MOTEL to "Motel",
        PointCategory.NATURAL_BAY to "Bay",
        PointCategory.NATURAL_CAVE_ENTRANCE to "Cave",
        PointCategory.NATURAL_GLACIER to "Glacier",
        PointCategory.NATURAL_HOT_SPRING to "Hot spring",
        PointCategory.NATURAL_LAKE to "Lake",
        PointCategory.NATURAL_MOUNTAIN_PASS to "Pass",
        PointCategory.NATURAL_PEAK to "Peak",
        PointCategory.NATURAL_SADDLE to "Saddle",
        PointCategory.NATURAL_STRAIT to "Strait",
        PointCategory.NATURAL_VOLCANO to "Volcano",
        PointCategory.NATURAL_WATERFALL to "Waterfall",
        PointCategory.SAFETY_CLINIC to "Clinic",
        PointCategory.SAFETY_MOUNTAIN_RESCUE to "Mountain rescue",
        PointCategory.SIGHT_OBSERVATION_TOWER to "Observation tower",
        PointCategory.SIGHT_VIEWPOINT to "Viewpoint",
        PointCategory.WATER_SPRING to "Spring",
        PointCategory.WATER_TAP to "Water tap",
    )

// The boundaries trailcatalog's search lists under National Parks and its sitemap lists
val NATIONAL_PARK_CATEGORIES =
    RelationCategory.entries.filter {
      RelationCategory.BOUNDARY_NATIONAL_PARK.isParentOf(it)
          || RelationCategory.BOUNDARY_PROTECTED_AREA_2.isParentOf(it)
    }

enum class WayCategory(override val id: Int) : Category<WayCategory> {
  ANY(0),
    HIGHWAY(ANY.id * ENUM_SIZE + 1),
      // railway=rail lands on RAIL itself, the way highway=road lands on ROAD.
      RAIL(HIGHWAY.id * ENUM_SIZE + 1),
        RAIL_NARROW_GAUGE(RAIL.id * ENUM_SIZE + 1),
        RAIL_PRESERVED(RAIL.id * ENUM_SIZE + 2),
        RAIL_FUNICULAR(RAIL.id * ENUM_SIZE + 3),

        // Transit, as opposed to the mainline rail above.
        RAIL_SUBWAY(RAIL.id * ENUM_SIZE + 4),
        RAIL_LIGHT_RAIL(RAIL.id * ENUM_SIZE + 5),
        RAIL_TRAM(RAIL.id * ENUM_SIZE + 6),
        RAIL_MONORAIL(RAIL.id * ENUM_SIZE + 7),

        // From service=*, which rides alongside railway=* rather than replacing it.
        RAIL_YARD(RAIL.id * ENUM_SIZE + 8),
        RAIL_SIDING(RAIL.id * ENUM_SIZE + 9),
        RAIL_SPUR(RAIL.id * ENUM_SIZE + 10),

      ROAD(HIGHWAY.id * ENUM_SIZE + 2),
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
        // highway=construction with the class it will become in construction=*, which the basemap
        // styles exactly like that class.
        ROAD_CONSTRUCTION(ROAD.id * ENUM_SIZE + 21),
          ROAD_CONSTRUCTION_MOTORWAY(ROAD_CONSTRUCTION.id * ENUM_SIZE + 1),
          ROAD_CONSTRUCTION_TRUNK(ROAD_CONSTRUCTION.id * ENUM_SIZE + 2),
          ROAD_CONSTRUCTION_PRIMARY(ROAD_CONSTRUCTION.id * ENUM_SIZE + 3),
          ROAD_CONSTRUCTION_SECONDARY(ROAD_CONSTRUCTION.id * ENUM_SIZE + 4),
          ROAD_CONSTRUCTION_TERTIARY(ROAD_CONSTRUCTION.id * ENUM_SIZE + 5),
          ROAD_CONSTRUCTION_MINOR(ROAD_CONSTRUCTION.id * ENUM_SIZE + 6),

      PATH(HIGHWAY.id * ENUM_SIZE + 3),
        // A bare highway=footway is as often a mountain trail as a city sidewalk, so footway=*
        // splits off the ones that only exist to carry a pedestrian alongside a road.
        PATH_FOOTWAY(PATH.id * ENUM_SIZE + 1),
          PATH_FOOTWAY_SIDEWALK(PATH_FOOTWAY.id * ENUM_SIZE + 1),
          PATH_FOOTWAY_CROSSING(PATH_FOOTWAY.id * ENUM_SIZE + 2),
        PATH_BRIDLEWAY(PATH.id * ENUM_SIZE + 2),
        PATH_STEPS(PATH.id * ENUM_SIZE + 3),
        PATH_CORRIDOR(PATH.id * ENUM_SIZE + 4),
        PATH_CYCLEWAY(PATH.id * ENUM_SIZE + 5),
        PATH_VIA_FERRATA(PATH.id * ENUM_SIZE + 6),

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

    AERIALWAY(ANY.id * ENUM_SIZE + 3),
      AERIALWAY_CABLE_CAR(AERIALWAY.id * ENUM_SIZE + 1),
      AERIALWAY_GONDOLA(AERIALWAY.id * ENUM_SIZE + 2),
      AERIALWAY_MIXED_LIFT(AERIALWAY.id * ENUM_SIZE + 3),
      AERIALWAY_CHAIR_LIFT(AERIALWAY.id * ENUM_SIZE + 4),
      AERIALWAY_DRAG_LIFT(AERIALWAY.id * ENUM_SIZE + 5),
      AERIALWAY_T_BAR(AERIALWAY.id * ENUM_SIZE + 6),
      AERIALWAY_J_BAR(AERIALWAY.id * ENUM_SIZE + 7),
      AERIALWAY_PLATTER(AERIALWAY.id * ENUM_SIZE + 8),
      AERIALWAY_ROPE_TOW(AERIALWAY.id * ENUM_SIZE + 9),
      AERIALWAY_MAGIC_CARPET(AERIALWAY.id * ENUM_SIZE + 10),
      AERIALWAY_ZIP_LINE(AERIALWAY.id * ENUM_SIZE + 11),
      AERIALWAY_GOODS(AERIALWAY.id * ENUM_SIZE + 12),

    WATERWAY(ANY.id * ENUM_SIZE + 4),
      WATERWAY_FERRY(WATERWAY.id * ENUM_SIZE + 1),
      WATERWAY_RIVER(WATERWAY.id * ENUM_SIZE + 2),
      WATERWAY_STREAM(WATERWAY.id * ENUM_SIZE + 3),
      WATERWAY_CANAL(WATERWAY.id * ENUM_SIZE + 4),
      WATERWAY_DITCH(WATERWAY.id * ENUM_SIZE + 5),
      WATERWAY_DRAIN(WATERWAY.id * ENUM_SIZE + 6),

    AEROWAY(ANY.id * ENUM_SIZE + 5),
      AEROWAY_RUNWAY(AEROWAY.id * ENUM_SIZE + 1),
      AEROWAY_TAXIWAY(AEROWAY.id * ENUM_SIZE + 2),
      AEROWAY_TAXILANE(AEROWAY.id * ENUM_SIZE + 3),
      AEROWAY_HELIPAD(AEROWAY.id * ENUM_SIZE + 4),
      // Areas in OSM. A closed way still dumps as a line, so the style decides whether an outline
      // is worth drawing until the collection carries polygons.
      AEROWAY_APRON(AEROWAY.id * ENUM_SIZE + 5),
      AEROWAY_AERODROME(AEROWAY.id * ENUM_SIZE + 6),

    // Was folded into HIGHWAY so that DumpPaths would keep it, which makes a coastline draw as a
    // road once anything styles by category.
    NATURAL(ANY.id * ENUM_SIZE + 6),
      NATURAL_COASTLINE(NATURAL.id * ENUM_SIZE + 1),
      NATURAL_TREE_ROW(NATURAL.id * ENUM_SIZE + 2),
      NATURAL_CLIFF(NATURAL.id * ENUM_SIZE + 3),
      NATURAL_RIDGE(NATURAL.id * ENUM_SIZE + 4),
      NATURAL_ARETE(NATURAL.id * ENUM_SIZE + 5),
      NATURAL_VALLEY(NATURAL.id * ENUM_SIZE + 6),

    MAN_MADE(ANY.id * ENUM_SIZE + 7),
      MAN_MADE_PIER(MAN_MADE.id * ENUM_SIZE + 1),
      MAN_MADE_BREAKWATER(MAN_MADE.id * ENUM_SIZE + 2),
      MAN_MADE_GROYNE(MAN_MADE.id * ENUM_SIZE + 3),
  ;
}

fun aDescendsB(a: Int, b: Int): Boolean {
  var cursor = a
  while (b < cursor) {
    cursor = (cursor - 1) / ENUM_SIZE
  }
  return b == cursor
}
