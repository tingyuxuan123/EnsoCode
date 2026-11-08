package io.github.tingyuxuan123.eaves.ui

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import io.github.tingyuxuan123.eaves.mirror.DesktopFileChunk
import io.github.tingyuxuan123.eaves.mirror.DesktopFilesState

/**
 * Read-only artifact browser. Lists opaque file IDs from the host, opens them as text or images,
 * and pages through the host's bounded chunks. Nothing here writes to the workspace.
 */
@Composable
internal fun SessionFilesContent(
    panels: SessionPanels,
    files: DesktopFilesState?,
    onList: (() -> Unit)?,
    onRead: ((String, Long) -> Unit)?,
) {
    val c = Enso.colors
    LaunchedEffect(panels.surface, files?.entries, files?.listing) {
        if (panels.surface == SessionSurface.Files && files == null && onList != null) onList()
    }
    val opened = panels.openedFile
    val chunk = files?.chunk?.takeIf { it.fileId == opened }
    if (opened == null) {
        when {
            files == null || files.listing -> SheetHint("正在读取桌面文件列表…")
            files.listError != null -> SheetHint("读取失败：${files.listError}")
            files.entries.isEmpty() -> SheetHint("这个会话还没有可浏览的产物。")
            else -> Column(Modifier.padding(horizontal = 12.dp).fillMaxWidth()
                .background(c.card, RoundedCornerShape(20.dp))) {
                files.entries.forEachIndexed { index, entry ->
                    if (index > 0) Hairline()
                    Row(Modifier.fillMaxWidth().clickable(enabled = onRead != null, role = Role.Button) {
                        panels.openedFile = entry.id
                        onRead?.invoke(entry.id, 0)
                    }.padding(horizontal = 16.dp, vertical = 11.dp),
                        horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Glyph(EnsoIcon.Files, Modifier.size(16.dp), c.ink2)
                        Column(Modifier.weight(1f)) {
                            Label(entry.name, 15, 20, weight = FontWeight.Medium, maxLines = 1)
                            Label("${entry.rel} · ${fileSizeLabel(entry.size)}", 12, 16, color = c.dim, maxLines = 1)
                        }
                        Glyph(EnsoIcon.Right, Modifier.size(16.dp), c.faint)
                    }
                }
            }
        }
        if (files?.listError != null) SheetHint("列表可能不完整；不会自动重试。")
        return
    }
    val entry = files?.entries?.firstOrNull { it.id == opened }
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.heightIn(min = 32.dp).clip(RoundedCornerShape(50)).background(c.card2)
            .clickable(role = Role.Button) { panels.openedFile = null }.padding(horizontal = 12.dp, vertical = 6.dp),
            contentAlignment = Alignment.Center) { Label("返回列表", 13, 18, color = c.ink2) }
        Label(entry?.name ?: chunk?.name ?: "文件", 14, 20, Modifier.weight(1f), weight = FontWeight.Medium, maxLines = 1)
        if (chunk != null) Label("${chunk.offset + chunk.data.size} / ${chunk.size}", 12, 16, color = c.dim)
    }
    when {
        files?.reading == true && chunk == null -> SheetHint("正在读取…")
        files?.readError != null -> SheetHint("读取失败：${files.readError}")
        chunk == null -> SheetHint("正在读取…")
        else -> FileChunkBody(entry?.name ?: chunk.name ?: "", chunk)
    }
    if (chunk != null && files?.reading != true) {
        val loaded = chunk.offset + chunk.data.size
        if (loaded < chunk.size) {
            Box(Modifier.padding(horizontal = 16.dp, vertical = 6.dp).fillMaxWidth().heightIn(min = 44.dp)
                .glass().clickable(enabled = onRead != null && files.readError == null, role = Role.Button) {
                    onRead?.invoke(chunk.fileId, loaded)
                }, contentAlignment = Alignment.Center) { Label("加载更多", 14, 20, weight = FontWeight.Medium) }
        }
        if (chunk.size > chunk.data.size) {
            Label("为控制流量只读取分段；不会把整份文件写进手机存储。", 12, 16,
                Modifier.padding(horizontal = 24.dp, vertical = 4.dp), color = c.faint)
        }
    }
}

@Composable
private fun FileChunkBody(name: String, chunk: DesktopFileChunk) {
    val c = Enso.colors
    val preview = remember(chunk, name) { previewFile(name, chunk.data) }
    val shape = RoundedCornerShape(20.dp)
    when (preview.kind) {
        FileKind.Empty -> SheetHint("文件是空的。")
        FileKind.Binary -> SheetHint("二进制文件（${fileSizeLabel(chunk.size.toLong())}），本批只浏览文本与图片。")
        FileKind.Image -> {
            val bitmap = remember(chunk) {
                runCatching { BitmapFactory.decodeByteArray(chunk.data, 0, chunk.data.size) }.getOrNull()
            }
            if (bitmap == null) SheetHint("图片无法解码；可能是分段不完整或格式未支持。")
            else Image(bitmap.asImageBitmap(), contentDescription = "图片预览", modifier =
                Modifier.padding(horizontal = 12.dp, vertical = 8.dp).fillMaxWidth().clip(shape)
                    .background(c.card), contentScale = ContentScale.Fit)
        }
        FileKind.Text -> Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp).fillMaxWidth()
            .background(c.card, shape).padding(horizontal = 16.dp, vertical = 14.dp)
            .semantics { contentDescription = "文件内容" }) {
            Text(preview.text.orEmpty(), color = c.ink, style = ensoText(13, 20, font = Enso.mono))
            if (preview.truncated) Label("预览已截断；加载更多可继续读取。", 12, 16,
                Modifier.padding(top = 8.dp), color = c.dim)
        }
    }
}
