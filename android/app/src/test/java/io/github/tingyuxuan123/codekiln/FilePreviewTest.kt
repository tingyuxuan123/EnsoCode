package io.github.tingyuxuan123.eaves

import io.github.tingyuxuan123.eaves.ui.FileKind
import io.github.tingyuxuan123.eaves.ui.previewFile
import io.github.tingyuxuan123.eaves.ui.fileSizeLabel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class FilePreviewTest {
    @Test fun `utf8 text is shown and invalid bytes fall back to binary`() {
        val text = previewFile("README.md", "# Collabra\n\n- 一条".toByteArray())
        assertEquals(FileKind.Text, text.kind)
        assertEquals("# Collabra\n\n- 一条", text.text)
        assertEquals(FileKind.Binary, previewFile("blob.bin", byteArrayOf(1, 0, 2, 0)).kind)
        assertEquals(FileKind.Binary, previewFile("broken.txt", byteArrayOf(0xC3.toByte())).kind)
    }

    @Test fun `known image signatures decode as images before any extension guess`() {
        val png = byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0)
        val jpeg = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xE0.toByte(), 0, 0)
        assertEquals(FileKind.Image, previewFile("anything.txt", png).kind)
        assertEquals(FileKind.Image, previewFile("photo", jpeg).kind)
        assertEquals(FileKind.Empty, previewFile("empty.png", byteArrayOf()).kind)
    }

    @Test fun `previews are bounded and say when they were shortened`() {
        val preview = previewFile("big.txt", "a".repeat(500_000).toByteArray())
        assertEquals(FileKind.Text, preview.kind)
        assertEquals(true, preview.truncated)
        assertEquals(120_000, requireNotNull(preview.text).length)
        assertNull(previewFile("empty.txt", byteArrayOf()).text)
    }

    @Test fun `sizes are exact for small files and unit bounded for large ones`() {
        assertEquals("0 B", fileSizeLabel(0))
        assertEquals("999 B", fileSizeLabel(999))
        assertEquals("1 KB", fileSizeLabel(1_024))
        assertEquals("1.5 KB", fileSizeLabel(1_536))
        assertEquals("1 MB", fileSizeLabel(1_048_576))
        assertEquals("2.5 MB", fileSizeLabel(2_621_440))
        assertEquals("—", fileSizeLabel(-1))
    }
}
