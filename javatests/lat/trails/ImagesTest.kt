package lat.trails

import com.google.common.truth.Truth.assertThat
import org.junit.Assert.assertThrows
import org.junit.Test

class ImagesTest {

  @Test
  fun testKeepsTextAndNumbersWithoutSourceFile() {
    val exif = parse(""""Model": "iPhone 16 Pro", "FNumber": 1.8""")

    assertThat(exif.toString()).isEqualTo("""{"Model":"iPhone 16 Pro","FNumber":1.8}""")
  }

  @Test
  fun testRejectsNestedValues() {
    assertThrows(IllegalStateException::class.java) {
      parse(""""Model": {"evil": true}""")
    }
  }

  @Test
  fun testRejectsLongText() {
    assertThrows(IllegalStateException::class.java) {
      parse(""""Model": "${"x".repeat(1000)}"""")
    }
  }

  @Test
  fun testSignsLocationByHemisphere() {
    val exif =
        parse(
            """"GPSLatitudeRef": "S", "GPSLatitude": 33.85, """
                + """"GPSLongitudeRef": "W", "GPSLongitude": 151.2""")

    assertThat(getLocation(exif)).isEqualTo(ImageLocation(-33.85, -151.2))
  }

  @Test
  fun testNoLocationWithoutRef() {
    val exif = parse(""""GPSLatitude": 47.6, "GPSLongitudeRef": "W", "GPSLongitude": 122.3""")

    assertThat(getLocation(exif)).isNull()
  }

  @Test
  fun testNoLocationOutOfRange() {
    val exif =
        parse(
            """"GPSLatitudeRef": "N", "GPSLatitude": 91, """
                + """"GPSLongitudeRef": "E", "GPSLongitude": 10""")

    assertThat(getLocation(exif)).isNull()
  }

  @Test
  fun testCapturedSecondsAppliesOffset() {
    val exif =
        parse(""""DateTimeOriginal": "2026:10:31 09:08:31", "OffsetTimeOriginal": "-07:00"""")

    // 2026-10-31T16:08:31Z
    assertThat(getCapturedSeconds(exif)).isEqualTo(1793462911L)
  }

  @Test
  fun testNoCapturedSecondsWithoutOffset() {
    val exif = parse(""""DateTimeOriginal": "2026:10:31 16:08:31"""")

    assertThat(getCapturedSeconds(exif)).isNull()
  }

  @Test
  fun testNoCapturedSecondsForUnsetClock() {
    val exif =
        parse(""""DateTimeOriginal": "0000:00:00 00:00:00", "OffsetTimeOriginal": "+00:00"""")

    assertThat(getCapturedSeconds(exif)).isNull()
  }

  private fun parse(fields: String) =
      parseExif("""[{"SourceFile": "display.webp", $fields}]""".toByteArray())
}
