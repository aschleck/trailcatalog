package org.trailcatalog.importers.common

import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody
import org.trailcatalog.common.IORuntimeException
import java.io.InputStreamReader
import java.lang.Exception
import java.net.SocketTimeoutException
import java.nio.charset.StandardCharsets
import java.nio.file.Path
import kotlin.io.path.exists
import kotlin.io.path.name
import kotlin.io.path.outputStream
import kotlin.reflect.KClass

private val okhttp = OkHttpClient()

fun <R> fetch(url: HttpUrl, action: (body: ResponseBody, response: Response) -> R): R {
  return okhttp.newCall(Request.Builder().get().url(url).build())
      .execute()
      .use {
        if (!it.isSuccessful) {
          throw when (it.code) {
            404 -> NotFoundException("Not found: ${url}")
            else -> IORuntimeException("Error fetching ${url}: ${it.code}")
          }
        }

        it.body.use { body ->
          if (body == null) {
            throw IORuntimeException("Error fetching ${url}: (no body)")
          }

          action.invoke(body, it)
        }
      }
}

fun download(url: HttpUrl, to: Path) {
  retry(3, SocketTimeoutException::class) { downloadOnce(url, to) }
}

private fun downloadOnce(url: HttpUrl, to: Path) {
  val etag = to.resolveSibling("${to.name}.etag")
  val etagValue = etag.toFile().run {
    if (to.exists() && canRead()) {
      InputStreamReader(inputStream()).use {
        it.readText().trim()
      }
    } else {
      ""
    }
  }

  fetch(url) { body, response ->
    val foundEtag = response.headers["ETag"]
    if (foundEtag == etagValue) {
      return@fetch
    }

    to.toFile().outputStream().use { file ->
      val scale = 1000.0 /* b/kb */ * 1000.0 /* kb/mb */
      ProgressBar("downloading ${to.name}", "mb", body.contentLength().toDouble() / scale).use { progress ->
        val buffer = ByteArray(8 * 1024)
        body.byteStream().use { input ->
          while (true) {
            val read = input.read(buffer)
            if (read >= 0) {
              file.write(buffer, 0, read)
              progress.incrementBy(read / scale)
            } else {
              break
            }
          }
        }
      }
    }

    if (foundEtag != null) {
      etag.outputStream().use {
        it.write(foundEtag.toByteArray(StandardCharsets.UTF_8))
      }
    }
  }
}

class NotFoundException(message: String, throwable: Throwable? = null)
  : IORuntimeException(message, throwable)

private fun <E : Exception, T> retry(limit: Int, expect: KClass<E>, fn: () -> T): T {
  var backoffMs = 500L
  var failures = 0
  while (true) {
    try {
      return fn()
    } catch (e: Exception) {
      if (expect.isInstance(e)) {
        if (failures < limit) {
          failures += 1
          Thread.sleep(backoffMs)
          backoffMs *= 2
        } else {
          throw IORuntimeException("Out of retries", e)
        }
      } else {
        throw e
      }
    }
  }
}
