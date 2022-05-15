package org.trailcatalog.pbf

import crosby.binary.Osmformat.PrimitiveBlock
import crosby.binary.Osmformat.PrimitiveGroup

abstract class PbfEntityInputStream(
  protected val block: PrimitiveBlock,
  current: ByteArray,
) : IteratedInputStream<PrimitiveGroup>(block.primitivegroupList, current)