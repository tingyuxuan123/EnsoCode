package io.github.tingyuxuan123.eaves.ui

internal enum class FileKind { Text, Image, Binary, Empty }

internal data class FilePreview(val kind: FileKind, val text: String? = null, val truncated: Boolean = false)

private const val PREVIEW_CHARS = 120_000

/**
 * The host sends raw bytes, so the phone decides how to show them. Signature checks win over the
 * file name: a renamed PNG still previews as an image, and undecodable bytes never become text.
 */
internal fun previewFile(name: String, bytes: ByteArray): FilePreview {
    if (bytes.isEmpty()) return FilePreview(FileKind.Empty)
    if (isImage(bytes)) return FilePreview(FileKind.Image)
    val decoded = bytes.toString(Charsets.UTF_8)
    // A UTF-8 decode with U+FFFD means those bytes were not text; never show replacement soup.
    if ('\uFFFD' in decoded || decoded.any { it == '\u0000' }) return FilePreview(FileKind.Binary)
    val text = decoded.take(PREVIEW_CHARS)
    return FilePreview(FileKind.Text, text, decoded.length > PREVIEW_CHARS)
}

private fun isImage(bytes: ByteArray): Boolean = when {
    bytes.size >= 8 && bytes[0] == 0x89.toByte() && bytes[1] == 0x50.toByte() &&
        bytes[2] == 0x4E.toByte() && bytes[3] == 0x47.toByte() -> true
    bytes.size >= 3 && bytes[0] == 0xFF.toByte() && bytes[1] == 0xD8.toByte() && bytes[2] == 0xFF.toByte() -> true
    bytes.size >= 6 && bytes[0] == 0x47.toByte() && bytes[1] == 0x49.toByte() && bytes[2] == 0x46.toByte() -> true
    bytes.size >= 12 && bytes[0] == 0x52.toByte() && bytes[1] == 0x49.toByte() && bytes[2] == 0x46.toByte() &&
        bytes[3] == 0x46.toByte() && bytes[8] == 0x57.toByte() && bytes[9] == 0x45.toByte() &&
        bytes[10] == 0x42.toByte() && bytes[11] == 0x50.toByte() -> true
    else -> false
}

/** Binary units, not marketing units: 1 KB is 1024 bytes and values are truncated, never rounded up. */
internal fun fileSizeLabel(bytes: Long): String {
    if (bytes < 0) return "—"
    if (bytes < 1_024) return "$bytes B"
    val units = listOf(1_073_741_824L to "GB", 1_048_576L to "MB", 1_024L to "KB")
    for ((size, suffix) in units) {
        if (bytes < size) continue
        val whole = bytes / size
        val tenth = (bytes % size) * 10 / size
        return if (tenth == 0L) "$whole $suffix" else "$whole.$tenth $suffix"
    }
    return "$bytes B"
}
