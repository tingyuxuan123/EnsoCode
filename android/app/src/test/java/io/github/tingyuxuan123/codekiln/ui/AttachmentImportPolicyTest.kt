package io.github.tingyuxuan123.eaves.ui

import java.io.ByteArrayInputStream
import org.junit.Assert.*
import org.junit.Test

class AttachmentImportPolicyTest {
    @Test fun `fit never enlarges and keeps both axes positive`() {
        assertEquals(PictureSize(1600, 1200), fitPicture(4000, 3000, 1600))
        assertEquals(PictureSize(1, 1600), fitPicture(1, 16_000, 1600))
        assertEquals(PictureSize(50, 30), fitPicture(50, 30, 1600))
        assertEquals(PictureSize(800, 1600), fitPicture(1500, 3000, 1600))
    }

    @Test fun `source dimensions are bounded before full decode`() {
        assertTrue(validPictureDimensions(8000, 6000))
        assertFalse(validPictureDimensions(0, 200))
        assertFalse(validPictureDimensions(20_000, 20_000))
        assertFalse(validPictureDimensions(Int.MAX_VALUE, 1))
        assertEquals(4, pictureSampleSize(8000, 6000, 1600))
        assertEquals(1, pictureSampleSize(3000, 2000, 1600))
    }

    @Test fun `bounded reader rejects empty and oversize input without accepting a truncated image`() {
        val original = ByteArray(9) { it.toByte() }
        assertArrayEquals(original, readPictureBytes(ByteArrayInputStream(original), 9))
        assertThrows(PictureImportException::class.java) { readPictureBytes(ByteArrayInputStream(original), 8) }
        assertThrows(PictureImportException::class.java) { readPictureBytes(ByteArrayInputStream(ByteArray(0)), 8) }
    }
}
