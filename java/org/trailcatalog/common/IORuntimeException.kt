package org.trailcatalog.common

import java.lang.RuntimeException

open class IORuntimeException(message: String, throwable: Throwable? = null)
  : RuntimeException(message, throwable)