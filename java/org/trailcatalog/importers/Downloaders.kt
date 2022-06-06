package org.trailcatalog.importers

import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody
import java.io.InputStreamReader
import java.io.Reader
import java.lang.RuntimeException
import java.nio.charset.StandardCharsets
import java.nio.file.Path
import kotlin.io.path.name
import kotlin.io.path.outputStream

fun <R> fetch(url: HttpUrl, action: (body: ResponseBody, response: Response) -> R): R {
  val okhttp = OkHttpClient()
  return okhttp.newCall(Request.Builder().get().url(url).build())
      .execute()
      .use {
        if (!it.isSuccessful) {
          throw IORuntimeException("Error fetching ${url}: ${it.code}")
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
  val etag = to.resolveSibling("${to.name}.etag")
  val etagValue = etag.toFile().run {
    if (canRead()) {
      InputStreamReader(inputStream()).use {
        it.readText().trim()
      }
    } else {
      ""
    }
  }

  fetch(url) { body, response ->
    val foundEtag = response.headers["ETag"] ?: ""
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
            if (read > 0) {
              file.write(buffer, 0, read)
              progress.incrementBy(read / scale)
            } else {
              break
            }
          }
        }
      }
    }

    etag.outputStream().use {
      it.write(foundEtag.toByteArray(StandardCharsets.UTF_8))
    }
  }
}

class IORuntimeException(message: String) : RuntimeException(message)
