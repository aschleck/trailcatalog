package lat.trails.wire

// The schema the latest migration made, which every connection reads through
const val TRAILS_LAT_SCHEMA = "migration_14_bounds"

// The most line ids one lines request carries. 128 ids at 37 characters each is 4.7 KB, under the
// 8 KB buffer nginx's large_client_header_buffers default holds a request line in.
const val MAX_LINES_BY_ID = 128

// RPCs that write, so a client drops what it cached from reads
val WRITE_METHODS =
    listOf(
        "lat.trails.DataService/AcceptInvite",
        "lat.trails.DataService/CreateCollection",
        "lat.trails.DataService/CreateInvite",
        "lat.trails.DataService/DeleteAccount",
        "lat.trails.DataService/DeleteCollection",
        "lat.trails.DataService/RevokeInvite",
        "lat.trails.DataService/Save",
        "lat.trails.DataService/SetAnyoneCanView",
        "lat.trails.DataService/SetGrant",
        "lat.trails.DataService/SetViewState",
        "lat.trails.DataService/UpdateCollection",
    )
