package io.github.tingyuxuan123.eaves.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import io.github.tingyuxuan123.eaves.mirror.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private data class PreviewItem(val key: String, val name: String, val size: Long?, val rel: String?,
    val image: Boolean, val mediaId: String? = null, val error: String? = null)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun MemberArtifactSheet(target: DesktopBotArtifactTarget, bots: DesktopBotsState, onDismiss: () -> Unit,
    onList: ((DesktopBotArtifactTarget) -> Unit)?, onImage: ((DesktopBotArtifactTarget, String?, String?) -> Unit)?,
    onListFiles: ((DesktopBotArtifactTarget) -> Unit)?, onReadFile: ((DesktopBotArtifactTarget, String, Long) -> Unit)?,
    initialSelection: String? = null) {
    val c = Enso.colors
    val listing = bots.artifacts?.takeIf { it.target == target }
    val image = bots.artifactImage?.takeIf { it.target == target }
    val files = bots.files?.takeIf { bots.filesTarget == target }
    var selected by remember(target, initialSelection) { mutableStateOf(initialSelection) }
    LaunchedEffect(target, bots.artifacts?.phase) {
        if (listing == null && bots.artifacts?.phase != SessionCommandPhase.Waiting) onList?.invoke(target)
    }
    val entries = remember(listing) { buildList {
        listing?.artifacts?.forEach { add(PreviewItem("file-${it.rel}", it.name, it.size, it.rel, it.kind == "image")) }
        listing?.media?.forEachIndexed { index, media -> add(PreviewItem("media-${media.mediaId ?: index}",
            media.name ?: media.caption ?: "图片 ${index + 1}", null, null, true, media.mediaId, media.error)) }
    }.distinctBy { it.key } }
    val opened = entries.firstOrNull { it.key == selected }
    if (opened == null) {
        ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = c.page, contentColor = c.ink, shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)) {
            LazyColumn(Modifier.fillMaxWidth(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)) {
                item {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Label("本轮产物", 17, 22, Modifier.weight(1f).padding(start = 4.dp), weight = FontWeight.SemiBold)
                        GlyphButton(EnsoIcon.Close, "关闭产物列表", 40.dp, 20.dp, tint = c.dim, onClick = onDismiss)
                    }
                }
                if (entries.isEmpty()) item { SheetHint(when (listing?.phase) {
                    SessionCommandPhase.Observed -> "这条回复没有可预览的产物。"
                    SessionCommandPhase.Rejected, SessionCommandPhase.Unconfirmed -> "未能读取本轮产物。"
                    else -> "正在读取桌面产物…"
                }) }
                items(entries, key = { it.key }) { entry ->
                    Row(Modifier.fillMaxWidth().background(c.card, RoundedCornerShape(16.dp))
                        .clickable(role = Role.Button) { selected = entry.key }.padding(horizontal = 14.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Glyph(EnsoIcon.Files, Modifier.size(20.dp), c.ink2)
                        Label(entry.name, 15, 20, Modifier.weight(1f), weight = FontWeight.Medium, maxLines = 1)
                        entry.size?.let { Label(fileSizeLabel(it), 12, 16, color = c.dim) }
                        Glyph(EnsoIcon.Right, Modifier.size(16.dp), c.faint)
                    }
                }
            }
        }
        return
    }
    val file = files?.entries?.firstOrNull { it.rel == opened.rel }
    val chunk = files?.chunk?.takeIf { it.fileId == file?.id }
    val selectedImage = image?.takeIf { it.mediaId == opened.mediaId && it.rel == opened.rel }
    LaunchedEffect(opened.key, bots.artifactImage?.phase) {
        if (opened.image && opened.error == null && selectedImage == null && bots.artifactImage?.phase != SessionCommandPhase.Waiting) {
            onImage?.invoke(target, opened.mediaId, opened.rel)
        }
    }
    LaunchedEffect(opened.key) { if (!opened.image && files == null) onListFiles?.invoke(target) }
    LaunchedEffect(opened.key, file?.id, files?.reading) {
        if (!opened.image && file != null && chunk == null && !files.reading && files.readError == null) {
            onReadFile?.invoke(target, file.id, 0)
        }
    }
    Dialog(onDismissRequest = { selected = null }, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Column(Modifier.fillMaxSize().background(c.page).designTopInset().designBottomInset(20.dp)) {
            TopBar(opened.name, EnsoIcon.Back, "返回产物列表", { selected = null }, opened.size?.let(::fileSizeLabel))
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, bottom = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                entries.forEach { entry ->
                    val current = entry.key == opened.key
                    Label(entry.name, 14, 20, Modifier.background(if (current) c.pill else c.card2, Enso.pillShape)
                        .clickable(role = Role.Tab) { selected = entry.key }.padding(horizontal = 16.dp, vertical = 8.dp),
                        color = if (current) c.pillInk else c.ink2, weight = FontWeight.Medium, maxLines = 1)
                }
            }
            LazyColumn(Modifier.weight(1f).padding(horizontal = 12.dp).fillMaxWidth()
                .background(c.card, RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp)),
                contentPadding = PaddingValues(horizontal = 20.dp, vertical = 20.dp)) {
                item {
                    if (opened.image) MemberArtifactImage(selectedImage, opened.error)
                    else when {
                        files?.listError != null || files?.readError != null -> SheetHint("未能读取桌面文件。")
                        files != null && !files.listing && file == null -> SheetHint("此文件已不可读取。")
                        chunk == null -> SheetHint("正在读取桌面文件…")
                        else -> {
                            val preview = remember(chunk) { previewFile(opened.name, chunk.data) }
                            when (preview.kind) {
                                FileKind.Empty -> SheetHint("文件是空的。")
                                FileKind.Text -> if (opened.name.endsWith(".md", true) && chunk.offset == 0L) SessionMarkdown(preview.text.orEmpty(), compact = true)
                                    else Label(preview.text.orEmpty(), 14, 21, color = c.ink2)
                                else -> SheetHint("此格式暂不能在手机预览，请在电脑端打开。")
                            }
                            val next = chunk.offset + chunk.data.size
                            if (next < chunk.size && chunk.data.isNotEmpty()) Label(if (files.reading) "正在加载…" else "加载下一段", 14, 20,
                                Modifier.clickable(enabled = !files.reading && onReadFile != null, role = Role.Button) {
                                    onReadFile?.invoke(target, chunk.fileId, next)
                                }.padding(vertical = 12.dp), color = c.blue)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun MemberArtifactImage(image: DesktopBotArtifactImage?, error: String?) {
    val url = image?.dataUrl
    val decoded by produceState<Pair<Boolean, android.graphics.Bitmap?>>(false to null, url) {
        value = false to null
        if (url != null) value = true to withContext(Dispatchers.Default) {
            val prefix = url.substringBefore(',')
            decodeTimelineImage(TimelineImage(url.substringAfter(',', ""), prefix.removePrefix("data:").removeSuffix(";base64")))
        }
    }
    decoded.second?.let { Image(it.asImageBitmap(), "图片预览", Modifier.fillMaxWidth(), contentScale = ContentScale.Fit) }
        ?: SheetHint(when {
            error != null || image?.phase in setOf(SessionCommandPhase.Rejected, SessionCommandPhase.Unconfirmed) -> "图片暂不可预览。"
            decoded.first -> "图片无法解码。"
            url != null -> "正在解码图片…"
            else -> "正在读取图片…"
        })
}
