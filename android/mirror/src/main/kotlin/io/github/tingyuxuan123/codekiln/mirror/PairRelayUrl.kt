package io.github.tingyuxuan123.eaves.mirror

import java.net.URI
import java.net.URISyntaxException
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

object PairRelayUrl {
    internal const val MAX_LENGTH = 4096
    private val numericLabel = Regex("[0-9]+|0x[0-9a-f]*", RegexOption.IGNORE_CASE)
    private val escapedDot = Regex("%2e", RegexOption.IGNORE_CASE)
    private val ambiguousEscape = Regex("%(?:[01][0-9a-f]|7f|25|2f|5c|23|3f)", RegexOption.IGNORE_CASE)

    fun parse(relayUrl: String, allowLoopbackHttp: Boolean = false): HttpUrl {
        if (relayUrl.length > MAX_LENGTH || relayUrl.any { it.isWhitespace() || it.isISOControl() || it == '\uFEFF' || it == '\\' }) {
            invalid()
        }
        // OkHttp alone would repair missing slashes and some malformed authority/path inputs.
        val strict = try {
            URI(relayUrl)
        } catch (_: URISyntaxException) {
            invalid()
        }
        val authority = strict.rawAuthority ?: invalid()
        val host = strict.host ?: invalid()
        if (strict.rawUserInfo != null || '@' in authority || '%' in authority || authority.endsWith(':') ||
            strict.rawQuery != null || strict.rawFragment != null || strict.port !in -1..65535 || strict.port == 0
        ) invalid()
        if (!strict.scheme.equals("https", ignoreCase = true) &&
            !(allowLoopbackHttp && strict.scheme.equals("http", ignoreCase = true) && host == "127.0.0.1")
        ) invalid()

        // Do not allow a resolver to reinterpret shortened, octal, hex or integer IPv4 spellings.
        if (numericLabel.matches(host.trimEnd('.').substringAfterLast('.'))) {
            val octets = host.split('.')
            if (octets.size != 4 || octets.any { it.toIntOrNull() !in 0..255 || it != it.toInt().toString() }) invalid()
        }

        // As in packages/pair/src/handshake.ts, endpoint suffixes append to a reverse-proxy prefix.
        val path = strict.rawPath.orEmpty().trimEnd('/')
        if ("//" in path || ambiguousEscape.containsMatchIn(path) ||
            path.split('/').any { escapedDot.replace(it, ".") in setOf(".", "..") }
        ) invalid()
        val parsed = relayUrl.trimEnd('/').toHttpUrlOrNull() ?: invalid()
        if (parsed.toString().length > MAX_LENGTH) invalid()
        return parsed
    }

    fun isLoopback(url: HttpUrl): Boolean = url.host == "127.0.0.1"

    internal fun endpoint(relay: HttpUrl, lastSegment: String): HttpUrl.Builder =
        relay.newBuilder().addPathSegments("v1/pair").addPathSegment(lastSegment)

    private fun invalid(): Nothing = throw IllegalArgumentException("Invalid pairing relay URL")
}
