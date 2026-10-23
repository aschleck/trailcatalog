package lat.trails.wire

// The format of a collection tile, see ApiServer.kt#fetchCollectionObjects.
const val OBJECTS_WIRE_VERSION = 4

// How a tile encodes its objects.
//
// Pack the trailcatalog paths into four varints instead of a UUID and a JSON blob, saving about
// 46 bytes a line. They are rows in a table we own, so the id fits a varint and the only attributes
// are the source way, the category, and the traits. A user collection needs the general form: its
// objects are identified by UUID and described by the jsonb its creator wrote.
//
// Points pack the same way, and carry their name because OSM names a node on the node.
const val KIND_UUID_JSON = 0
const val KIND_PACKED_PATH = 1
const val KIND_PACKED_POINT = 2
