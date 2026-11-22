package io.github.tingyuxuan123.codekiln.ui

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
import androidx.compose.runtime.collectAsState
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
import io.github.tingyuxuan123.codekiln.mirror.DesktopFileChunk
import io.github.tingyuxuan123.codekiln.mirror.DesktopFileEntry
import io.github.tingyuxuan123.codekiln.mirror.FileDownloadTarget
import io.github.tingyuxuan123.codekiln.mirror.DesktopFilesState

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
    fetchFile: ArtifactChunkReader? = null,
    downloads: ArtifactDownloads? = null,
    target: FileDownloadTarget? = null,
) {
    val c = Enso.colors
    val transfers = downloads?.state?.collectAsState()?.value.orEmpty()
    LaunchedEffect(panels.surface, files?.entries, files?.listing) {
        if (panels.surface == SessionSurface.Files && files == null && onList != null) onList()
    }
    val opened = panels.openedFile
    val chunk = files?.chunk?.takeIf { it.fileId == opened }
    val fileLink = panels.fileLink
    LaunchedEffect(fileLink, files?.entries, files?.listing) {
        if (fileLink != null && files?.listing == false && files.listError == null) {
            fileLink.match(files.entries)?.let { entry ->
                panels.fileLink = null
                openSessionArtifact(panels, entry, fetchFile, onRead, downloads, target)
            }
        }
    }
    if (opened == null) {
        when {
            files == null || files.listing -> SheetHint("正在读取桌面文件列表…")
            files.listError != null -> SheetHint("读取失败：${files.listError}")
            files.entries.isEmpty() -> SheetHint("这个会话还没有可浏览的产物。")
            else -> Column(Modifier.padding(horizontal = 12.dp).fillMaxWidth()
                .background(c.card, RoundedCornerShape(20.dp))) {
                files.entries.forEachIndexed { index, entry ->
                    if (index > 0) Hairline()
                    Row(Modifier.fillMaxWidth().clickable(enabled = onRead != null || fetchFile != null, role = Role.Button) {
                        openSessionArtifact(panels, entry, fetchFile, onRead, downloads, target)
                    }.padding(horizontal = 16.dp, vertical = 11.dp),
                        horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Glyph(EnsoIcon.Files, Modifier.size(16.dp), c.ink2)
                        Column(Modifier.weight(1f)) {
                            Label(entry.name, 15, 20, weight = FontWeight.Medium, maxLines = 1)
                            val status = target?.let { transfers[ArtifactDownloadKey(it, entry.id)].cardLabel() }
                            Label(status ?: "${entry.rel} · ${fileSizeLabel(entry.size)}", 12, 16, color = c.dim, maxLines = 1)
                        }
                        Glyph(EnsoIcon.Right, Modifier.size(16.dp), c.faint)
                    }
                }
            }
        }
        if (fileLink != null && files?.listing == false && files.listError == null) SheetHint("未找到这条链接对应的会话产物。")
        if (files?.listError != null) SheetHint("列表可能不完整；不会自动重试。")
        return
    }
    val entry = files?.entries?.firstOrNull { it.id == opened }
    val directAction = entry?.takeIf { fetchFile != null }?.let { artifactActionOnTap(it.name) }
    val transfer = target?.let { transfers[ArtifactDownloadKey(it, opened)] }
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.heightIn(min = 32.dp).clip(RoundedCornerShape(50)).background(c.card2)
            .clickable(role = Role.Button) { panels.openedFile = null; panels.fileAction = null }.padding(horizontal = 12.dp, vertical = 6.dp),
            contentAlignment = Alignment.Center) { Label("返回列表", 13, 18, color = c.ink2) }
        Label(entry?.name ?: chunk?.name ?: "文件", 14, 20, Modifier.weight(1f), weight = FontWeight.Medium, maxLines = 1)
        if (directAction != null) Label(fileSizeLabel(entry.size), 12, 16, color = c.dim)
        else if (chunk != null) Label("${chunk.offset + chunk.data.size} / ${chunk.size}", 12, 16, color = c.dim)
    }
    if (entry != null && fetchFile != null && downloads != null && target != null) {
        ArtifactFileActions(entry, target, downloads, fetchFile, !files.reading && !files.listing, panels.fileAction) {
            panels.fileAction = null
        }
        if (directAction != null || transfer.isAvailableOrDownloading()) return
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
            Label("这里是分段预览，选择「保存文件」可取回完整文件。", 12, 16,
                Modifier.padding(horizontal = 24.dp, vertical = 4.dp), color = c.faint)
        }
    }
}

internal fun openSessionArtifact(panels: SessionPanels, entry: DesktopFileEntry,
    fetchFile: ArtifactChunkReader?, onRead: ((String, Long) -> Unit)?, downloads: ArtifactDownloads? = null,
    target: FileDownloadTarget? = null) {
    panels.openedFile = entry.id
    panels.surface = SessionSurface.Files
    val transfer = target?.let { downloads?.state?.value?.get(ArtifactDownloadKey(it, entry.id)) }
    if (transfer.isAvailableOrDownloading()) {
        panels.fileAction = null
        return
    }
    panels.fileAction = fetchFile?.let { artifactActionOnTap(entry.name) }
    if (panels.fileAction == null) onRead?.invoke(entry.id, 0)
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
