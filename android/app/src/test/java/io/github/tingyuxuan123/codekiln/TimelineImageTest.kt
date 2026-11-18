package io.github.tingyuxuan123.eaves

import io.github.tingyuxuan123.eaves.ui.timelineImages
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Test

class TimelineImageTest {
    private fun part(source: String) = Json.parseToJsonElement(source) as JsonObject

    @Test fun `only complete image parts become thumbnails`() {
        val images = timelineImages(listOf(
            part("""{"type":"text","text":"hi"}"""),
            part("""{"type":"image","data":"AAAA","mimeType":"image/png"}"""),
            part("""{"type":"image","data":"BBBB","mimeType":"image/jpeg"}"""),
        ))
        assertEquals(listOf("AAAA", "BBBB"), images.map { it.data })
        assertEquals("image/png", images.first().mimeType)
    }

    @Test fun `dirty or unsupported parts are ignored instead of crashing the turn`() {
        val images = timelineImages(listOf(
            part("""{"type":"image"}"""),
            part("""{"type":"image","data":"","mimeType":"image/png"}"""),
            part("""{"type":"image","data":"AAAA","mimeType":"image/tiff"}"""),
            part("""{"type":"image","data":"AAAA","mimeType":false}"""),
            part("""{"type":"image","data":"AAAA","mimeType":"image/webp"}"""),
            part("""{"type":"image","data":"not base64 !!","mimeType":"image/png"}"""),
        ))
        assertEquals(listOf("AAAA"), images.map { it.data })
    }

    @Test fun `huge payloads are skipped so one message cannot exhaust the phone`() {
        val huge = "A".repeat(4_000_001)
        val images = timelineImages(listOf(part("""{"type":"image","data":"$huge","mimeType":"image/png"}""")))
        assertEquals(0, images.size)
    }
}
