package lat.trails

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.node.ObjectNode
import io.javalin.http.BadRequestResponse
import io.javalin.http.ServiceUnavailableResponse
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.StandardProtocolFamily
import java.net.UnixDomainSocketAddress
import java.nio.channels.Channels
import java.nio.channels.SocketChannel
import java.nio.file.Files
import java.nio.file.Path
import java.util.UUID
import java.util.concurrent.Semaphore
import java.util.concurrent.TimeUnit
import lat.trails.wire.IMAGE_SIZES

// Each encode holds up to 1 GB, the encoder's MemoryMax in configuration.nix.
private const val MAX_ENCODES = 7
// nginx gives up after 60 s, proxy_read_timeout's default, and an encode takes up to 30 s, the
// encoder's RuntimeMaxSec in configuration.nix. Waiting longer would commit images after the client
// got a 504.
private const val ENCODE_WAIT_SECONDS = 20L

// A 2048 px photo encodes to about 1 MB, so this leaves room for one that compresses badly.
private const val MAX_IMAGE_SIZE_BYTES = 8 * 1024 * 1024

/**
 * Keeps each image's sizes in a directory named by its id, under a directory named by the id's
 * first two characters so that no one directory holds every image.
 */
class LocalImages(private val root: Path) {

  fun path(id: UUID, size: String): Path {
    return directory(id).resolve("${size}.webp")
  }

  fun write(id: UUID, size: String, content: ByteArray) {
    val path = path(id, size)
    Files.createDirectories(path.parent)
    Files.write(path, content)
  }

  // An image may have no files, since an upload inserts its row before writing them.
  fun delete(id: UUID) {
    check(directory(id).toFile().deleteRecursively())
  }

  private fun directory(id: UUID): Path {
    val name = id.toString()
    return root.resolve(name.substring(0, 2)).resolve(name)
  }
}

// exiftool's JSON for about twenty fields is a few hundred bytes.
private const val MAX_METADATA_BYTES = 64 * 1024

class EncodedImage(
    // in IMAGE_SIZES order
    val sizes: List<ByteArray>,
    // exiftool's tag names to their values, all of them text or numbers
    val exif: ObjectNode,
    val location: ImageLocation?,
)

data class ImageLocation(val latDegrees: Double, val lngDegrees: Double)

/** Sends originals to production/files/trails_lat_image_encoder.sh. */
class ImageEncoder(private val socket: Path) {

  private val encodes = Semaphore(MAX_ENCODES, /* fair= */ true)

  /**
   * Returns the encoded sizes and their metadata, or throws BadRequestResponse if the encoder
   * refused the original. The encoder read a hostile file that could have taken it over, so we
   * check what it answers.
   */
  fun encode(original: InputStream): EncodedImage {
    if (!encodes.tryAcquire(ENCODE_WAIT_SECONDS, TimeUnit.SECONDS)) {
      throw ServiceUnavailableResponse("Too many images are uploading")
    }
    try {
      return SocketChannel.open(StandardProtocolFamily.UNIX).use { channel ->
        channel.connect(UnixDomainSocketAddress.of(socket))
        original.transferTo(Channels.newOutputStream(channel))
        channel.shutdownOutput()
        read(BufferedInputStream(Channels.newInputStream(channel)))
      }
    } finally {
      encodes.release()
    }
  }

  // The encoder writes nothing when it refuses an original or systemd kills it, so an empty answer
  // is a bad image rather than a broken encoder.
  private fun read(input: InputStream): EncodedImage {
    val header = readHeader(input) ?: throw BadRequestResponse("Unable to read that image")
    val fields = header.split(" ")
    if (fields.size != IMAGE_SIZES.size + 1) {
      throw IllegalStateException("The image encoder answered $header")
    }
    val parts =
        fields.mapIndexed { i, field ->
          val max = if (i < IMAGE_SIZES.size) MAX_IMAGE_SIZE_BYTES else MAX_METADATA_BYTES
          val length = field.toIntOrNull()
          if (length == null || length !in 1..max) {
            throw IllegalStateException("The image encoder answered $header")
          }
          input.readNBytes(length).also {
            if (it.size != length) {
              throw IllegalStateException("The image encoder ended early")
            }
          }
        }
    val exif = parseExif(parts.last())
    return EncodedImage(parts.dropLast(1), exif, getLocation(exif))
  }
}

// The header is a few numbers, so anything longer than this is an error.
private const val MAX_HEADER_BYTES = 64

// Returns the first line, or null if the input is empty.
private fun readHeader(input: InputStream): String? {
  val line = ByteArrayOutputStream()
  while (true) {
    val b = input.read()
    if (b == -1 && line.size() == 0) {
      return null
    } else if (b == -1 || line.size() > MAX_HEADER_BYTES) {
      throw IllegalStateException("The image encoder's header is malformed")
    } else if (b == '\n'.code) {
      return line.toString(Charsets.US_ASCII)
    }
    line.write(b)
  }
}

// exiftool names about twenty fields, and the GPS group adds a dozen more.
private const val MAX_EXIF_FIELDS = 64
private const val MAX_EXIF_TEXT_LENGTH = 256
private val EXIF_FIELD_NAME = Regex("[A-Za-z0-9]{1,64}")

/**
 * Parses the encoder's exiftool JSON. The encoder read a hostile file, so we accept only flat text
 * and numbers of bounded size. Which fields appear is the encoder's allowlist.
 */
fun parseExif(json: ByteArray): ObjectNode {
  val mapper = ObjectMapper()
  val root = mapper.readTree(json)
  val tags = root?.singleOrNull()
  if (root == null || !root.isArray || tags == null || !tags.isObject) {
    throw IllegalStateException("The image encoder's metadata is malformed")
  }

  val exif = mapper.createObjectNode()
  for ((name, value) in tags.properties()) {
    if (name == "SourceFile") {
      continue
    }
    val valid =
        EXIF_FIELD_NAME.matches(name)
            && ((value.isTextual && value.asText().length <= MAX_EXIF_TEXT_LENGTH)
                || (value.isNumber && value.asDouble().isFinite()))
    if (!valid || exif.size() >= MAX_EXIF_FIELDS) {
      throw IllegalStateException("The image encoder's metadata is malformed")
    }
    exif.set<JsonNode>(name, value)
  }
  return exif
}

/** Returns where the photo was taken, or null if its GPS tags are missing or malformed. */
fun getLocation(exif: ObjectNode): ImageLocation? {
  val lat = getCoordinate(exif, "GPSLatitude", "N", "S", 90.0)
  val lng = getCoordinate(exif, "GPSLongitude", "E", "W", 180.0)
  return if (lat != null && lng != null) ImageLocation(lat, lng) else null
}

// exiftool's -n prints a coordinate's magnitude and leaves its hemisphere in the Ref tag.
private fun getCoordinate(
    exif: ObjectNode, tag: String, positive: String, negative: String, max: Double): Double? {
  val magnitude = exif.get(tag)
  if (magnitude == null || !magnitude.isNumber || magnitude.asDouble() !in 0.0..max) {
    return null
  }
  return when (exif.get("${tag}Ref")?.asText()) {
    positive -> magnitude.asDouble()
    negative -> -magnitude.asDouble()
    else -> null
  }
}
