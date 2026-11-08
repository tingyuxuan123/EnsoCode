package io.github.tingyuxuan123.eaves.pair

import java.io.ByteArrayOutputStream
import java.net.IDN
import java.net.URI
import java.net.URISyntaxException
import java.util.Base64
import java.util.Locale

data class PairInvite(val relay: String, val publicKey: ByteArray)

/** Compatibility boundary for packages/pair/src/encoding.ts. No network or Android dependency. */
object PairEncoding {
    fun toBase64Url(bytes: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)

    fun fromBase64Url(text: String): ByteArray {
        // TS pads BEFORE atob removes ASCII whitespace. Preserve that otherwise surprising order.
        val base = text.replace('-', '+').replace('_', '/')
        val padded = base + "=".repeat((4 - base.length % 4) % 4)
        val compact = padded.filterNot { it == '\t' || it == '\n' || it == '\u000c' || it == '\r' || it == ' ' }
        return try {
            Base64.getDecoder().decode(compact)
        } catch (error: IllegalArgumentException) {
            throw IllegalArgumentException("Invalid base64url", error)
        }
    }

    fun parsePairUri(uri: String): PairInvite {
        val text = uri.trim { it.isWhitespace() || it == '\uFEFF' }
        if (text.startsWith("enso://pair?")) {
            // TS's custom-scheme regex is not dotAll; embedded line terminators cannot match.
            require(text.none { it == '\r' || it == '\n' || it == '\u2028' || it == '\u2029' }) {
                "Invalid pair URI"
            }
            return fromParams(text.substringAfter('?'))
        }
        require(text.startsWith("https://", ignoreCase = true) || text.startsWith("http://", ignoreCase = true)) {
            "Not an enso pair URI"
        }
        // URL strips these characters before parsing its HTTP path, query and fragment.
        val url = text.filterNot { it == '\t' || it == '\r' || it == '\n' }
        val beforeFragment = url.substringBefore('#')
        val fragment = url.substringAfter('#', "")
        val queryStart = beforeFragment.indexOf('?')
        val query = if (queryStart >= 0) beforeFragment.substring(queryStart) else ""
        return fromParams(fragment.ifEmpty { query }, origin(url))
    }

    private fun fromParams(text: String, fallbackRelay: String? = null): PairInvite {
        val params = linkedMapOf<String, String>()
        for (part in text.removePrefix("?").split('&')) {
            if (part.isEmpty()) continue
            val key = formDecode(part.substringBefore('='))
            val value = formDecode(if ('=' in part) part.substringAfter('=') else "")
            params.putIfAbsent(key, value)
        }
        val relay = params["relay"] ?: fallbackRelay
        val key = params["pk"]
        require(!relay.isNullOrEmpty() && !key.isNullOrEmpty()) { "Pair URI missing relay or pk" }
        return PairInvite(relay, fromBase64Url(key))
    }

    private fun origin(text: String): String {
        val scheme = text.substringBefore(':').lowercase(Locale.ROOT)
        val authority = text.substringAfter("://").takeWhile { it !in "/\\?#" }.substringAfterLast('@')
        val normalized = if (authority.startsWith('[')) authority else {
            val host = authority.substringBefore(':')
            require(host.isNotEmpty()) { "Pair URI missing host" }
            val ascii = try {
                IDN.toASCII(host)
            } catch (_: IllegalArgumentException) {
                throw IllegalArgumentException("Invalid pair URI origin")
            }
            ascii.lowercase(Locale.ROOT) + authority.substring(host.length)
        }
        val parsed = try {
            URI("$scheme://$normalized")
        } catch (_: URISyntaxException) {
            throw IllegalArgumentException("Invalid pair URI origin")
        }
        val host = parsed.host?.lowercase(Locale.ROOT)
        require(!host.isNullOrEmpty() && parsed.port in -1..65535) { "Invalid pair URI origin" }
        val port = parsed.port
        val suffix = if (port == -1 || (scheme == "https" && port == 443) || (scheme == "http" && port == 80)) "" else ":$port"
        return "$scheme://$host$suffix"
    }

    /** URLSearchParams keeps malformed percent escapes and uses replacement UTF-8 decoding. */
    private fun formDecode(text: String): String {
        val bytes = ByteArrayOutputStream()
        var index = 0
        while (index < text.length) {
            val char = text[index]
            val hi = text.getOrNull(index + 1)?.digitToIntOrNull(16)
            val lo = text.getOrNull(index + 2)?.digitToIntOrNull(16)
            when {
                char == '+' -> { bytes.write(32); index++ }
                char == '%' && hi != null && lo != null -> { bytes.write(hi * 16 + lo); index += 3 }
                else -> {
                    val point = text.codePointAt(index)
                    val value = if (point in 0xD800..0xDFFF) "\uFFFD" else String(Character.toChars(point))
                    bytes.write(value.toByteArray(Charsets.UTF_8))
                    index += Character.charCount(point)
                }
            }
        }
        return bytes.toByteArray().toString(Charsets.UTF_8)
    }
}
