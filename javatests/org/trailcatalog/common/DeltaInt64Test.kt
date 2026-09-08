package org.trailcatalog.common

import com.google.common.truth.Truth.assertThat
import java.util.Random
import org.junit.Test

class DeltaInt64Test {

  @Test
  fun roundTripsEmpty() {
    assertThat(DeltaInt64.decode(DeltaInt64.encode(LongArray(0)))).isEmpty()
    assertThat(DeltaInt64.valueCount(DeltaInt64.encode(LongArray(0)))).isEqualTo(0)
  }

  @Test
  fun roundTripsOneValue() {
    val values = longArrayOf(1_756_000_000)
    assertThat(DeltaInt64.decode(DeltaInt64.encode(values))).isEqualTo(values)
  }

  @Test
  fun roundTripsTheExtremes() {
    val values = longArrayOf(Long.MAX_VALUE, Long.MIN_VALUE, 0, Long.MAX_VALUE)
    assertThat(DeltaInt64.decode(DeltaInt64.encode(values))).isEqualTo(values)
  }

  @Test
  fun roundTripsRandomRuns() {
    val random = Random(/* seed= */ 20260906)
    for (trial in 0 until 500) {
      val valueCount = 1 + random.nextInt(200)
      val values = LongArray(valueCount)
      var value = random.nextLong() / 4
      for (i in 0 until valueCount) {
        // Steps wide enough to span every varint width.
        value += random.nextInt() / 2
        values[i] = value
      }

      val encoded = DeltaInt64.encode(values)
      assertThat(DeltaInt64.valueCount(encoded)).isEqualTo(valueCount)
      assertThat(DeltaInt64.decode(encoded)).isEqualTo(values)
      assertThat(encoded.size).isAtMost(DeltaInt64.bytesFor(valueCount))
    }
  }

  @Test
  fun packsGpxSamplesIntoOneByte() {
    // A track that gained 60 cm and then 50 cm on samples a second apart, which is what the
    // elevation and time columns hold.
    val elevation = longArrayOf(140_000, 140_060, 140_110)
    assertThat(DeltaInt64.encode(elevation)).hasLength(/* count= */ 1 + /* first= */ 8 + 2)
    val time = longArrayOf(1_756_000_000, 1_756_000_001, 1_756_000_002)
    assertThat(DeltaInt64.encode(time)).hasLength(/* count= */ 1 + /* first= */ 8 + 2)
  }
}
