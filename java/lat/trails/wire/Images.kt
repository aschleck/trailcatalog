package lat.trails.wire

// Every image is stored at each of these sizes. The number is the most pixels along the longer
// edge. thumbnail is big enough for a map icon or a list row on a 3x screen, and display for a
// photo shown full screen. Keep in sync with production/files/trails_lat_image_encoder.sh.
val IMAGE_SIZES = listOf("thumbnail" to 128, "display" to 2048)

// A 48 MP phone photo is about 25 MB as a JPEG.
const val MAX_ORIGINAL_SIZE_BYTES = 32 * 1024 * 1024
