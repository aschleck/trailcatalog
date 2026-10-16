package lat.trails.importers

import java.io.IOException
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import org.slf4j.LoggerFactory

private val logger = LoggerFactory.getLogger("Http")

// Retries wait 10, 20, 40, and then 80 seconds.
private const val FETCH_ATTEMPTS = 5

private val client = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NORMAL).build()

/** Fetches a URL, retrying on 429s, 5xxs, and dropped connections. */
fun fetchBytes(url: String): ByteArray {
  return send(HttpRequest.newBuilder(URI.create(url)).build(), 200)
}

/** Fetches length bytes of a URL starting at offset, retrying like fetchBytes. */
fun fetchRange(url: String, offset: Long, length: Long): ByteArray {
  val request =
      HttpRequest.newBuilder(URI.create(url))
          .header("Range", "bytes=${offset}-${offset + length - 1}")
          .build()
  val bytes = send(request, 206)
  check(bytes.size.toLong() == length) { "${url} sent ${bytes.size} bytes, not ${length}" }
  return bytes
}

private fun send(request: HttpRequest, expected: Int): ByteArray {
  val url = request.uri()
  var attempt = 0
  while (true) {
    try {
      val response = client.send(request, HttpResponse.BodyHandlers.ofByteArray())
      if (response.statusCode() == 429 || response.statusCode() >= 500) {
        throw IOException("${url} answered ${response.statusCode()}")
      }
      check(response.statusCode() == expected) { "${url} answered ${response.statusCode()}" }
      return response.body()
    } catch (e: IOException) {
      attempt += 1
      if (attempt == FETCH_ATTEMPTS) {
        throw e
      }
      logger.warn("Retrying after {}", e.message)
      Thread.sleep(10_000L shl (attempt - 1))
    }
  }
}
