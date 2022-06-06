package org.trailcatalog.importers.pipeline

import com.google.common.truth.Truth.assertThat
import org.junit.Test
import org.trailcatalog.importers.pipeline.collections.PCollection
import org.trailcatalog.importers.pipeline.collections.PMap

class PipelineTest {

  @Test
  fun testJoin2() {
    val test = Pipeline()
    val a = test.read(SequenceSource((0 until 20).asSequence())).groupBy { it }
    val b = test.read(SequenceSource((15 downTo 4).asSequence())).groupBy { it }
    val debug = Debug<PMap<Int, Pair<List<Int>, List<Int>>>>()
    test.join2(a, b).write(debug)
    test.execute()

    assertThat(debug.values).containsExactly(
        "PEntry(key=0, values=[([0], [])])",
        "PEntry(key=1, values=[([1], [])])",
        "PEntry(key=2, values=[([2], [])])",
        "PEntry(key=3, values=[([3], [])])",
        "PEntry(key=4, values=[([4], [4])])",
        "PEntry(key=5, values=[([5], [5])])",
        "PEntry(key=6, values=[([6], [6])])",
        "PEntry(key=7, values=[([7], [7])])",
        "PEntry(key=8, values=[([8], [8])])",
        "PEntry(key=9, values=[([9], [9])])",
        "PEntry(key=10, values=[([10], [10])])",
        "PEntry(key=11, values=[([11], [11])])",
        "PEntry(key=12, values=[([12], [12])])",
        "PEntry(key=13, values=[([13], [13])])",
        "PEntry(key=14, values=[([14], [14])])",
        "PEntry(key=15, values=[([15], [15])])",
        "PEntry(key=16, values=[([16], [])])",
        "PEntry(key=17, values=[([17], [])])",
        "PEntry(key=18, values=[([18], [])])",
        "PEntry(key=19, values=[([19], [])])",
    )
  }

  @Test
  fun testJoin2Then() {
    val test = Pipeline()
    val a = test.read(SequenceSource((0 until 20).asSequence())).groupBy { it }
    val b = test.read(SequenceSource((15 downTo 4).asSequence())).groupBy { it }
    val debug = Debug<PCollection<Int>>()
    test.join2(a, b).then(Sum()).write(debug)
    test.execute()

    assertThat(debug.values).containsExactly(
        "0",
        "1",
        "2",
        "3",
        "8",
        "10",
        "12",
        "14",
        "16",
        "18",
        "20",
        "22",
        "24",
        "26",
        "28",
        "30",
        "16",
        "17",
        "18",
        "19",
    )
  }
}