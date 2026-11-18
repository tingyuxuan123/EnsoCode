package io.github.tingyuxuan123.eaves

import android.content.ClipboardManager
import android.content.Context
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.UriHandler
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performFirstLinkClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import io.github.tingyuxuan123.eaves.ui.EnsoTheme
import io.github.tingyuxuan123.eaves.ui.SessionMarkdown
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@OptIn(ExperimentalTestApi::class)
@RunWith(AndroidJUnit4::class)
class SessionMarkdownTest {
    @get:Rule val compose = createComposeRule()

    @Test fun tappingAnUnderlinedDownloadLinkOpensItsExactWebAddress() {
        val url = "https://example.com/download.apk?key=a%2Fb&n=2#test"
        val plainUrl = "https://example.com/next.apk"
        val opened = show("[下载测试 APK]($url)\n\n$plainUrl")
        clickLink("下载测试 APK")
        clickLink(plainUrl)
        compose.runOnIdle { assertEquals(listOf(url, plainUrl), opened) }
    }

    @Test fun pairingDeepLinksAndLocalFilesAreNotLaunchedFromAgentText() {
        val opened = show("[配对](enso://pair?test=true)\n\n[文件](file:///data/local/tmp/test)")
        clickLink("配对")
        clickLink("文件")
        compose.runOnIdle { assertEquals(emptyList<String>(), opened) }
    }

    @Test fun codeBlockCopiesTheWholeUrlEvenWhenItDoesNotFitOnScreen() {
        val url = "https://example.com/" + "a".repeat(160) + "/test.apk?x=1&y=2"
        show("```text\n$url\n```")
        await(url)
        compose.onNodeWithText("复制").performClick()
        val clipboard = InstrumentationRegistry.getInstrumentation().targetContext.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        compose.runOnIdle { assertEquals(url, clipboard.primaryClip?.getItemAt(0)?.text?.toString()) }
    }

    private fun show(markdown: String): List<String> {
        val opened = mutableListOf<String>()
        val browser = object : UriHandler { override fun openUri(uri: String) { opened.add(uri) } }
        compose.setContent { EnsoTheme {
            CompositionLocalProvider(LocalUriHandler provides browser) { SessionMarkdown(markdown) }
        } }
        return opened
    }

    private fun clickLink(label: String) {
        await(label)
        compose.onNodeWithText(label).performFirstLinkClick()
    }

    private fun await(text: String) {
        compose.waitUntil(8_000) { compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty() }
    }
}
