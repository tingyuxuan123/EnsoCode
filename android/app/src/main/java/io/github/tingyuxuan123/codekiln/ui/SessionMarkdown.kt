package io.github.tingyuxuan123.codekiln.ui

import android.content.ClipData
import android.content.ClipDescription
import android.os.Build
import android.os.PersistableBundle
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.UriHandler
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.mikepenz.markdown.compose.components.markdownComponents
import com.mikepenz.markdown.compose.elements.MarkdownCodeBlock
import com.mikepenz.markdown.compose.elements.MarkdownCodeFence
import com.mikepenz.markdown.m3.Markdown
import com.mikepenz.markdown.m3.elements.MarkdownCheckBox
import com.mikepenz.markdown.m3.markdownColor
import com.mikepenz.markdown.m3.markdownTypography
import com.mikepenz.markdown.model.markdownPadding
import java.net.URI
import java.net.URISyntaxException
import java.util.Locale
import kotlinx.coroutines.launch

internal val LocalConversationLink = compositionLocalOf<((SessionLink) -> Boolean)?> { null }

/** Only explicit web addresses may be handed to Android's external URI handler. */
internal fun sessionWebUrl(raw: String): String? {
    val uri = try { URI(raw) } catch (_: URISyntaxException) { return null }
    val scheme = uri.scheme?.lowercase(Locale.ROOT) ?: return null
    if ((scheme != "https" && scheme != "http") || uri.host.isNullOrEmpty() ||
        uri.rawUserInfo != null || uri.port !in -1..65535) return null
    // Android's intent filters are case-sensitive; don't re-encode the path, query or fragment.
    return scheme + raw.substring(uri.scheme.length)
}

private val SessionMarkdownComponents = markdownComponents(
    codeFence = { MarkdownCodeFence(it.content, it.node, it.typography.code, block = { code, language, style ->
        SessionCodeBlock(code, language, style)
    }) },
    codeBlock = { MarkdownCodeBlock(it.content, it.node, it.typography.code, block = { code, language, style ->
        SessionCodeBlock(code, language, style)
    }) },
    checkbox = { MarkdownCheckBox(it.content, it.node, it.typography.text) },
)

@Composable
internal fun SessionMarkdown(text: String, compact: Boolean = false) {
    val c = Enso.colors
    val context = LocalContext.current
    val browser = LocalUriHandler.current
    val desktopLink = rememberUpdatedState(LocalConversationLink.current)
    // A local link can only select a host-listed item. Never send it to an external Android app.
    val webLinks = remember(browser, context) { object : UriHandler {
        override fun openUri(uri: String) {
            val url = when (val link = sessionLink(uri)) {
                is SessionLink.Browser -> link.url
                is SessionLink.Preview, is SessionLink.File -> {
                    if (desktopLink.value?.invoke(link) != true) {
                        Toast.makeText(context, "此处无法打开桌面文件或本地网页", Toast.LENGTH_SHORT).show()
                    }
                    return
                }
                null -> {
                    Toast.makeText(context, "无法打开此链接", Toast.LENGTH_SHORT).show()
                    return
                }
            }
            try { browser.openUri(url) }
            catch (_: IllegalArgumentException) {
                Toast.makeText(context, "找不到可打开链接的浏览器", Toast.LENGTH_SHORT).show()
            } catch (_: SecurityException) {
                Toast.makeText(context, "系统未允许打开链接", Toast.LENGTH_SHORT).show()
            }
        }
    } }
    CompositionLocalProvider(LocalUriHandler provides webLinks) {
        SelectionContainer {
            // Same text-first hierarchy as the PC Markdown, adapted to the narrow reading column.
            val prose = if (compact) ensoText(14, 23) else ensoText(15, 25)
            Markdown(content = text, modifier = Modifier.fillMaxWidth(), components = SessionMarkdownComponents,
                padding = markdownPadding(list = 2.dp, listItemTop = 2.dp, listItemBottom = 2.dp, listIndent = 12.dp),
                colors = markdownColor(text = c.ink, codeBackground = c.card2),
                typography = markdownTypography(text = prose, paragraph = prose, ordered = prose, bullet = prose, list = prose,
                    h1 = ensoText(19, 27, FontWeight.SemiBold), h2 = ensoText(18, 26, FontWeight.SemiBold),
                    h3 = ensoText(16, 24, FontWeight.SemiBold), h4 = ensoText(15, 24, FontWeight.Medium),
                    h5 = ensoText(15, 24), h6 = ensoText(15, 24), quote = prose,
                    code = ensoText(13, 20, font = Enso.mono), inlineCode = ensoText(13, 20, font = Enso.mono)))
        }
    }
}

@Composable
private fun SessionCodeBlock(code: String, language: String?, style: TextStyle) {
    val c = Enso.colors
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val shape = RoundedCornerShape(8.dp)
    Column(Modifier.fillMaxWidth().padding(vertical = 8.dp).clip(shape).background(c.card2)) {
        Row(Modifier.fillMaxWidth().padding(start = 12.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Label(language?.takeIf { it.isNotBlank() } ?: "代码", 12, 16, Modifier.weight(1f), color = c.dim, maxLines = 1)
            Row(Modifier.heightIn(min = 48.dp).clip(Enso.pillShape).clickable(role = Role.Button) {
                scope.launch {
                    val clip = ClipData.newPlainText("CodeKiln", code)
                    if (Build.VERSION.SDK_INT >= 33) clip.description.extras = PersistableBundle().apply {
                        // Code and signed download URLs may carry credentials; hide the system preview.
                        putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true)
                    }
                    clipboard.setClipEntry(ClipEntry(clip))
                    if (Build.VERSION.SDK_INT < 33) Toast.makeText(context, "已复制", Toast.LENGTH_SHORT).show()
                }
            }.padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                Label("复制", 13, 18, color = c.ink2, weight = FontWeight.Medium)
            }
        }
        Hairline()
        Text(code, Modifier.horizontalScroll(rememberScrollState()).padding(12.dp), color = c.ink, style = style)
    }
}
