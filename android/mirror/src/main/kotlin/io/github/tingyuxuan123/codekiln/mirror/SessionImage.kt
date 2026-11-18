package io.github.tingyuxuan123.eaves.mirror

import java.security.MessageDigest
import java.util.Base64
import kotlinx.serialization.json.JsonObject

const val SESSION_IMAGE_LIMIT = 4
const val SESSION_IMAGE_BYTES = 700_000

internal const val MAX_FRAME_BYTES = 1_048_576 // MAX_FRAME_BYTES in the relay.
private const val JPEG_MIME = "image/jpeg"
private const val MAX_IMAGE_DATA_CHARS = (SESSION_IMAGE_BYTES + 2) / 3 * 4
private const val FRAME_CRYPTO_BYTES = 1 + 12 + 16 // Version, AES-GCM nonce and tag.
// Empty strings include quotes. FrameReplay's maximal guest envelope adds 3 fixed 11-char IDs.
private const val EMPTY_PROMPT = """{"type":"prompt","sessionId":"","text":"","images":[],"replay":{"r":"g","p":"...........","c":"...........","e":"..........."}}"""
private const val EMPTY_IMAGE_DATA = """{"data":"","mimeType":"image/jpeg"}"""

data class SessionImage(val data: String, val mimeType: String = JPEG_MIME) {
    val fingerprint: String by lazy { imageFingerprint(mimeType, data) }

    // Composer budget checks may run as the caption changes. Cache only the size, not decoded bytes.
    internal val jpegBytes: Int? by lazy {
        if (mimeType != JPEG_MIME || data.length !in 8..MAX_IMAGE_DATA_CHARS || data.length % 4 != 0) return@lazy null
        val bytes = try { Base64.getDecoder().decode(data) } catch (_: IllegalArgumentException) { return@lazy null }
        if (bytes.size !in 5..SESSION_IMAGE_BYTES || bytes[0].toInt() != -1 || bytes[1].toInt() != -40 ||
            bytes[2].toInt() != -1 || bytes[bytes.lastIndex - 1].toInt() != -1 || bytes.last().toInt() != -39 ||
            Base64.getEncoder().encodeToString(bytes) != data) null else bytes.size
    }

    override fun toString(): String = "SessionImage(data=<redacted>)"
}

/** Fits an ordinary image prompt, including standard Base64, JPEG markers and the encrypted frame budget. */
fun sessionImagePromptFits(sessionId: String, text: String, images: List<SessionImage>): Boolean {
    if (sessionId.length !in 1..512 || text.length > SESSION_TEXT_LIMIT || images.size !in 1..SESSION_IMAGE_LIMIT) return false
    var rawBytes = 0
    var wireBytes = FRAME_CRYPTO_BYTES + EMPTY_PROMPT.length + jsonStringBodyBytes(sessionId) +
        jsonStringBodyBytes(imagePromptText(text)) + images.size - 1 // Commas between image objects.
    for (image in images) {
        rawBytes += image.jpegBytes ?: return false
        if (rawBytes > SESSION_IMAGE_BYTES) return false
        wireBytes += EMPTY_IMAGE_DATA.length + image.data.length // Canonical Base64 is unescaped ASCII.
    }
    return wireBytes < MAX_FRAME_BYTES
}

internal fun imagePromptText(text: String): String = if (text.all { it.isWhitespace() || it == '\uFEFF' }) "" else text

/** Mirrors the escaped UTF-8 contents of a WireJson string, excluding its surrounding quotes. */
private fun jsonStringBodyBytes(value: String): Int {
    var index = 0
    var bytes = 0
    while (index < value.length) {
        val char = value[index++]
        bytes += when {
            char == '"' || char == '\\' || char in "\b\t\n\u000C\r" -> 2
            char < '\u0020' -> 6
            char < '\u0080' -> 1
            char < '\u0800' -> 2
            char.isHighSurrogate() && value.getOrNull(index)?.isLowSurrogate() == true -> { index++; 4 }
            char.isSurrogate() -> 6 // WireJson escapes lone UTF-16 surrogates.
            else -> 3
        }
    }
    return bytes
}

internal fun SessionTextAttempt.matchesUserContent(content: List<JsonObject>): Boolean {
    // Leave the pre-existing text-only semantics unchanged.
    if (imageFingerprints.isEmpty()) return content.singleOrNull()?.let {
        it["type"].linkString() == "text" && it["text"].linkString() == text
    } == true

    if (content.size !in imageFingerprints.size..imageFingerprints.size + 1) return false
    val textParts = content.filter { it["type"].linkString() == "text" }
    if (textParts.isEmpty()) {
        if (text.isNotEmpty()) return false
    } else if (textParts.singleOrNull()?.get("text").linkString() != text) return false
    val images = content.filter { it["type"].linkString() != "text" }
    if (images.size != imageFingerprints.size) return false
    return images.indices.all { index ->
        val part = images[index]
        val data = part["data"].linkString() ?: return@all false
        part["type"].linkString() == "image" && part["mimeType"].linkString() == JPEG_MIME &&
            data.length in 8..MAX_IMAGE_DATA_CHARS && imageFingerprint(JPEG_MIME, data) == imageFingerprints[index]
    }
}

private fun imageFingerprint(mimeType: String, data: String): String {
    val digest = MessageDigest.getInstance("SHA-256")
    digest.update(mimeType.toByteArray(Charsets.UTF_8))
    digest.update(0.toByte()) // Separate MIME from the canonical Base64 data.
    return digest.digest(data.toByteArray(Charsets.UTF_8)).joinToString("") {
        (it.toInt() and 0xff).toString(16).padStart(2, '0')
    }
}
