package io.github.tingyuxuan123.eaves.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SessionWebUrlTest {
    @Test fun `完整网页地址可打开且不改写下载参数`() {
        for (url in listOf("https://example.com/file.apk?key=a%2Fb&v=2#asset", "http://[::1]:8080/")) {
            assertEquals(url, sessionWebUrl(url))
        }
        assertEquals("http://example.com:8080/path", sessionWebUrl("HTTP://example.com:8080/path"))
    }

    @Test fun `拒绝自定义协议文件相对路径用户信息与畸形网址`() {
        for (url in listOf("enso://pair?claim=test", "file:///sdcard/app.apk", "content://foo/item",
            "intent://example.com/#Intent;scheme=https;end", "javascript:alert(1)", "//example.com/file",
            "https:example.com/file", "https:///file", "https://example.com@wrong.example/file",
            "https://example.com\\@wrong.example/file", "https://example.com/file\n", "https://example.com/file name")) {
            assertNull(url, sessionWebUrl(url))
        }
    }
}
