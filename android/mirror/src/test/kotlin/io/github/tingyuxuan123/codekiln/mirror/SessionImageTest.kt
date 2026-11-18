package io.github.tingyuxuan123.eaves.mirror

import io.github.tingyuxuan123.eaves.pair.FrameReplay
import io.github.tingyuxuan123.eaves.pair.ReplayRole
import java.util.Base64
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import org.junit.Assert.*
import org.junit.Test

class SessionImageTest {
    @Test fun `image identity is stable and includes both bytes and MIME`() {
        val image = testSessionJpeg()
        assertEquals(image.fingerprint, image.copy().fingerprint)
        assertTrue(image.fingerprint.matches(Regex("[0-9a-f]{64}")))
        assertNotEquals(image.fingerprint, testSessionJpeg(pixel = 1).fingerprint)
        assertNotEquals(image.fingerprint, image.copy(mimeType = "image/png").fingerprint)
    }

    @Test fun `only bounded canonical padded base64 JPEGs fit an image prompt`() {
        val image = testSessionJpeg()
        assertTrue(sessionImagePromptFits("s", "", listOf(image)))
        assertTrue(sessionImagePromptFits("s", " \n", List(SESSION_IMAGE_LIMIT) { image }))
        assertFalse(sessionImagePromptFits("s", "text", emptyList()))
        assertFalse(sessionImagePromptFits("s", "", List(SESSION_IMAGE_LIMIT + 1) { image }))
        val max = testSessionJpeg(SESSION_IMAGE_BYTES - 6)
        assertTrue(sessionImagePromptFits("s", "", listOf(max, testSessionJpeg(6))))
        assertFalse(sessionImagePromptFits("s", "", listOf(max, image)))
        for (bad in listOf(
            image.copy(data = image.data.trimEnd('=')),
            image.copy(data = image.data.dropLast(3) + "R=="), // Nonzero padding bits.
            image.copy(data = image.data.replace('/', '_')),
            image.copy(data = "\n" + image.data),
            image.copy(data = "data:image/jpeg;base64," + image.data),
            image.copy(data = "content://photos/1"),
            image.copy(mimeType = "image/png"),
            image.copy(data = Base64.getEncoder().encodeToString(byteArrayOf(0, 0, 0, 0, 0, -1, -39))),
            image.copy(data = Base64.getEncoder().encodeToString(byteArrayOf(-1, -40, -1, 0, 0, 0, 0))),
        )) assertFalse(sessionImagePromptFits("s", "text", listOf(bad)))
    }

    @Test fun `size budget matches full encrypted frame for UTF8 controls and escaped strings`() {
        val image = testSessionJpeg(SESSION_IMAGE_BYTES)
        val key = ByteArray(32)
        val replay = FrameReplay(key, ReplayRole.Guest, requireModern = true)
        val host = FrameReplay(key, ReplayRole.Host, announce = true)
        replay.open(host.seal(buildJsonObject { put("type", "replay-hello") })) // Include the replay echo.
        val id = "雪\"\\\uD800"
        fun frameBytes(text: String) = replay.seal(buildJsonObject {
            put("type", "prompt")
            put("sessionId", id)
            put("text", text)
            putJsonArray("images") { addJsonObject { put("data", image.data); put("mimeType", image.mimeType) } }
        }).size

        val head = "雪🙂\"\\\uD800\uDC00\uD800\n\r\t\b\u000C"
        val spare = 1_048_575 - frameBytes(head)
        val fits = head + "\u0000".repeat(spare / 6) + "x".repeat(spare % 6)
        assertEquals(1_048_575, frameBytes(fits))
        assertEquals(1_048_576, frameBytes(fits + "x"))
        assertTrue(sessionImagePromptFits(id, fits, listOf(image)))
        assertFalse(sessionImagePromptFits(id, fits + "x", listOf(image)))
        assertTrue(sessionImagePromptFits(id, "雪".repeat(SESSION_TEXT_LIMIT), listOf(image)))
        assertFalse(sessionImagePromptFits(id, "x".repeat(SESSION_TEXT_LIMIT + 1), listOf(image)))
    }
}

/** Unit-test bytes with the JPEG markers; the actor does not decode pixels. */
internal fun testSessionJpeg(size: Int = 7, pixel: Byte = 0): SessionImage {
    val bytes = ByteArray(size) { pixel }
    bytes[0] = -1
    bytes[1] = -40
    bytes[2] = -1
    bytes[size - 2] = -1
    bytes[size - 1] = -39
    return SessionImage(Base64.getEncoder().encodeToString(bytes))
}
