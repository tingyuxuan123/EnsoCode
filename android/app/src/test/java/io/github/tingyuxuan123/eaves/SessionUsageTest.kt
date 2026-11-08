package io.github.tingyuxuan123.eaves

import io.github.tingyuxuan123.eaves.ui.contextPercent
import io.github.tingyuxuan123.eaves.ui.tokenCount
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SessionUsageTest {
    @Test fun `token counts stay exact small and shorten large values without rounding up a unit`() {
        assertEquals("0", tokenCount(0))
        assertEquals("999", tokenCount(999))
        assertEquals("1K", tokenCount(1_000))
        assertEquals("1.5K", tokenCount(1_500))
        assertEquals("12.3K", tokenCount(12_345))
        assertEquals("999.9K", tokenCount(999_949))
        assertEquals("1M", tokenCount(1_000_000))
        assertEquals("1.25M", tokenCount(1_250_000))
        assertEquals("1.99M", tokenCount(1_999_999))
        assertEquals("1.23B", tokenCount(1_234_567_890))
        assertEquals("1.25B", tokenCount(1_250_000_000))
    }

    @Test fun `negative counts never fabricate a label`() {
        assertEquals("—", tokenCount(-1))
    }

    @Test fun `context percent needs a known positive window and clamps to the bar`() {
        assertNull(contextPercent(50, null))
        assertNull(contextPercent(50, 0))
        assertNull(contextPercent(-5, 100))
        assertEquals(0, contextPercent(0, 100))
        assertEquals(38, contextPercent(76_000, 200_000))
        assertEquals(100, contextPercent(250_000, 200_000))
        assertEquals(1, contextPercent(1, 200_000))
    }
}
