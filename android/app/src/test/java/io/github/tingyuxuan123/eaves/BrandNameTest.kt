package io.github.tingyuxuan123.eaves

import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

/**
 * 桌面图标、安装器和系统设置里显示的应用名来自 `app_name`，
 * 默认资源和中文资源都必须是对外品牌「小满」。
 */
class BrandNameTest {
    private fun appName(resourceDir: String): String {
        val xml = File("src/main/res/$resourceDir/strings.xml").readText()
        return Regex("""<string name="app_name">([^<]+)</string>""")
            .find(xml)?.groupValues?.get(1) ?: error("$resourceDir 缺少 app_name")
    }

    @Test fun `默认与中文资源的应用名都是小满`() {
        assertEquals("小满", appName("values"))
        assertEquals("小满", appName("values-zh"))
    }
}
