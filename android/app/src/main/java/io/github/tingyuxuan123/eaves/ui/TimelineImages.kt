package io.github.tingyuxuan123.eaves.ui

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

internal data class TimelineImage(val data: String, val mimeType: String)

// A turn may carry images from a worker that already enforced its own budget; keep a local ceiling
// so a bad projection cannot allocate unbounded memory while rendering.
private const val MAX_IMAGE_CHARS = 4_000_000
private val IMAGE_TYPES = setOf("image/png", "image/jpeg", "image/webp", "image/gif")

internal fun timelineImages(content: List<JsonObject>): List<TimelineImage> = content.mapNotNull { part ->
    if ((part["type"] as? JsonPrimitive)?.content != "image") return@mapNotNull null
    val data = (part["data"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return@mapNotNull null
    val mime = (part["mimeType"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return@mapNotNull null
    if (mime !in IMAGE_TYPES || data.isEmpty() || data.length > MAX_IMAGE_CHARS) return@mapNotNull null
    // Reject anything that is not real standard base64 before it reaches the decoder.
    // java.util.Base64 exists since API 26 and keeps this filter testable on the JVM.
    val bytes = runCatching { java.util.Base64.getDecoder().decode(data) }.getOrNull() ?: return@mapNotNull null
    if (bytes.isEmpty()) return@mapNotNull null
    TimelineImage(data, mime)
}

internal fun decodeTimelineImage(image: TimelineImage): Bitmap? = runCatching {
    val bytes = java.util.Base64.getDecoder().decode(image.data)
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
}.getOrNull()
