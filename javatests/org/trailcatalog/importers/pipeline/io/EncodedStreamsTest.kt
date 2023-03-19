package org.trailcatalog.importers.pipeline.io

import com.google.common.truth.Truth.assertThat
import org.junit.Test
import org.trailcatalog.common.ChannelEncodedOutputStream
import org.trailcatalog.common.EncodedByteBufferInputStream
import java.io.File
import java.io.RandomAccessFile
import java.nio.channels.FileChannel.MapMode

class EncodedStreamsTest {

  @Test
  fun testStuff() {
    val file = File.createTempFile("test", "")
    file.deleteOnExit()

    val length = RandomAccessFile(file, "rw").use {
      it.channel.use { channel ->
        ChannelEncodedOutputStream(channel).use { output ->
          output.write(3)
          output.writeInt(30)
          output.writeInt(3_000)
          output.writeLong(300_000_000_000)
          output.writeVarInt(-3)
          output.writeVarInt(3)
          output.writeVarInt(30_000)
          output.writeVarInt(30_000_000)
          output.flush()
          output.position()
        }
      }
    }

    RandomAccessFile(file, "r").use {
      val input = EncodedByteBufferInputStream(it.channel.map(MapMode.READ_ONLY, 0, length))
      assertThat(input.read()).isEqualTo(3)
      assertThat(input.readInt()).isEqualTo(30)
      assertThat(input.readInt()).isEqualTo(3_000)
      assertThat(input.readLong()).isEqualTo(300_000_000_000)
      assertThat(input.readVarInt()).isEqualTo(-3)
      assertThat(input.readVarInt()).isEqualTo(3)
      assertThat(input.readVarInt()).isEqualTo(30_000)
      assertThat(input.readVarInt()).isEqualTo(30_000_000)
    }
  }
}