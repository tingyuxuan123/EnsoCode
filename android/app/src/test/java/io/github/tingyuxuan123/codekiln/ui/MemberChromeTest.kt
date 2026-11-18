package io.github.tingyuxuan123.eaves.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class MemberChromeTest {
    @Test fun `目录使用真实时间不把未来时间显示成负数`() {
        val now = 1_800_000_000_000
        assertEquals("刚刚", memberTime(now + 60_000, now))
        assertEquals("刚刚", memberTime(now - 59_999, now))
        assertEquals("1 分钟前", memberTime(now - 60_000, now))
        assertEquals("59 分钟前", memberTime(now - 3_599_999, now))
        assertEquals("今天 ${memberClock(now)}", memberDate(now, now))
    }
}
