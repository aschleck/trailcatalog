package org.trailcatalog.common

import java.io.ByteArrayOutputStream

class AlignableByteArrayOutputStream : ByteArrayOutputStream() {

  fun align(alignment: Int) {
    count = (count + alignment - 1) / alignment * alignment
    // No need to grow because the next write will catch up
  }
}