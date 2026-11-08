package io.github.tingyuxuan123.eaves.ui

import android.graphics.BitmapFactory
import android.util.Base64
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import io.github.tingyuxuan123.eaves.mirror.DesktopPreviewAction
import io.github.tingyuxuan123.eaves.mirror.DesktopPreviewFrame
import io.github.tingyuxuan123.eaves.mirror.DesktopPreviewInput
import io.github.tingyuxuan123.eaves.mirror.DesktopPreviewState
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * `preview.tsx`: the desktop renders a page into frames; taps, drags and keys are mapped back into
 * page coordinates. Nothing is simulated locally — every interaction is a host request.
 */
@Composable
internal fun SessionPreviewContent(
    panels: SessionPanels,
    preview: DesktopPreviewState?,
    onList: (() -> Unit)?,
    onOpen: ((String, Int, Int) -> Unit)?,
    onAction: ((DesktopPreviewAction) -> Unit)?,
    onInput: ((DesktopPreviewInput) -> Unit)?,
) {
    val c = Enso.colors
    LaunchedEffect(panels.surface, preview?.entries, preview?.listing) {
        if (panels.surface == SessionSurface.Preview && preview == null && onList != null) onList()
    }
    if (preview?.previewId == null) {
        when {
            preview == null || preview.listing -> SheetHint("正在查找桌面上的预览页…")
            preview.listError != null -> SheetHint("无法列出预览：${preview.listError}")
            preview.entries.isEmpty() -> SheetHint("电脑上没有正在运行的预览页。先在桌面打开网页预览。")
            else -> BoxWithConstraints {
                // The host renders a viewport and rejects out-of-range sizes; clamp instead of asking badly.
                val width = maxWidth.value.toInt().coerceIn(320, 1280)
                val height = 720.coerceIn(240, 1200)
                Column(Modifier.padding(horizontal = 12.dp).fillMaxWidth().background(c.card, RoundedCornerShape(20.dp))) {
                    preview.entries.forEachIndexed { index, entry ->
                        if (index > 0) Hairline()
                        Row(Modifier.fillMaxWidth().clickable(enabled = onOpen != null && !preview.busy,
                            role = Role.Button) { onOpen?.invoke(entry.id, width, height) }
                            .padding(horizontal = 16.dp, vertical = 12.dp),
                            horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                            Glyph(EnsoIcon.Globe, Modifier.size(16.dp), c.ink2)
                            Column(Modifier.weight(1f)) {
                                Label(entry.label, 15, 20, weight = FontWeight.Medium, maxLines = 1)
                                Label(if (entry.kind == "server") "本地服务" else "HTML 文件", 12, 16, color = c.dim)
                            }
                            Glyph(EnsoIcon.Right, Modifier.size(16.dp), c.faint)
                        }
                    }
                }
            }
        }
        preview?.error?.let { SheetHint("预览失败：$it") }
        return
    }
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 2.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        Label(preview.frame?.title ?: "网页预览", 14, 20, Modifier.weight(1f), weight = FontWeight.Medium, maxLines = 1)
        PreviewIconButton(EnsoIcon.Refresh, "刷新预览", !preview.busy) { onAction?.invoke(DesktopPreviewAction.Refresh) }
        PreviewIconButton(EnsoIcon.Close, "关闭预览", !preview.busy) { onAction?.invoke(DesktopPreviewAction.Close) }
    }
    val frame = preview.frame
    if (frame == null) {
        SheetHint(if (preview.busy) "正在打开…" else "还没有收到画面。")
    } else {
        PreviewFrameImage(frame, preview.busy, onInput)
        Label("点按、拖动都会发到电脑上的页面；下方按键与输入也会转发。", 12, 16,
            Modifier.padding(horizontal = 20.dp, vertical = 6.dp), color = c.dim)
        Row(Modifier.padding(horizontal = 12.dp).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            for ((label, key) in PREVIEW_KEYS) {
                Box(Modifier.weight(1f).heightIn(min = 40.dp).clip(RoundedCornerShape(12.dp)).background(c.card)
                    .clickable(enabled = !preview.busy, role = Role.Button) { onInput?.invoke(DesktopPreviewInput.Key(key)) }
                    .semantics { contentDescription = label }, contentAlignment = Alignment.Center) {
                    Label(label, 13, 18, color = c.ink2, weight = FontWeight.Medium)
                }
            }
        }
        PreviewTextBar(preview.busy, panels, onInput)
    }
    preview.error?.let { SheetHint("预览失败：$it") }
}

private val PREVIEW_KEYS = listOf(
    "Tab" to "Tab", "Esc" to "Escape", "回车" to "Enter",
    "上" to "ArrowUp", "下" to "ArrowDown", "退格" to "Backspace",
)

@Composable
private fun PreviewFrameImage(frame: DesktopPreviewFrame, busy: Boolean, onInput: ((DesktopPreviewInput) -> Unit)?) {
    val c = Enso.colors
    val bitmap = remember(frame.frameId) { decodeFrame(frame.dataUrl) }
    var dragged by remember(frame.frameId) { mutableStateOf(0f) }
    if (bitmap == null) {
        SheetHint("画面无法解码；请刷新预览。")
        return
    }
    Box(Modifier.padding(horizontal = 12.dp).fillMaxWidth().clip(RoundedCornerShape(18.dp))
        .background(c.camera)
        .pointerInput(frame.frameId, busy) {
            if (busy) return@pointerInput
            detectTapGestures { offset ->
                if (size.width > 0 && size.height > 0) {
                    val x = (offset.x / size.width * frame.width).roundToInt().coerceIn(0, frame.width)
                    val y = (offset.y / size.height * frame.height).roundToInt().coerceIn(0, frame.height)
                    onInput?.invoke(DesktopPreviewInput.Click(x, y))
                }
            }
        }
        .pointerInput(frame.frameId, busy) {
            if (busy) return@pointerInput
            detectDragGestures(onDragStart = { dragged = 0f },
                onDrag = { change, amount -> change.consume(); dragged += amount.y },
                onDragEnd = {
                    val delta = -dragged.roundToInt()
                    if (delta != 0) onInput?.invoke(DesktopPreviewInput.Scroll(0, delta))
                    dragged = 0f
                })
        }) {
        Image(bitmap.asImageBitmap(), contentDescription = "网页预览画面",
            modifier = Modifier.fillMaxWidth().aspectRatio(frame.width.toFloat() / frame.height.toFloat()),
            contentScale = ContentScale.Fit)
    }
}

@Composable
private fun PreviewTextBar(busy: Boolean, panels: SessionPanels, onInput: ((DesktopPreviewInput) -> Unit)?) {
    val c = Enso.colors
    val keyboard = LocalSoftwareKeyboardController.current
    val text = panels.previewText
    Row(Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, top = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        BasicTextField(text, { panels.previewText = it.take(PREVIEW_TEXT_LIMIT) },
            Modifier.weight(1f).heightIn(min = 48.dp).clip(CircleShape).background(c.card)
                .padding(horizontal = 16.dp, vertical = 12.dp)
                .semantics { contentDescription = "发到页面的文字" },
            readOnly = busy, singleLine = true, textStyle = ensoText(16, 22).copy(color = c.ink),
            cursorBrush = SolidColor(c.ink), decorationBox = { field -> Box {
                if (text.isEmpty()) Label("输入文字，发到页面里的焦点框", 16, 22, color = c.dim, maxLines = 1)
                field()
            } })
        Box(Modifier.size(48.dp).clip(CircleShape).background(if (busy || text.isBlank()) c.card2 else c.pill)
            .clickable(enabled = !busy && text.isNotBlank(), role = Role.Button) {
                keyboard?.hide()
                onInput?.invoke(DesktopPreviewInput.Text(text))
                panels.previewText = ""
            }.semantics { contentDescription = "发送到页面" }, contentAlignment = Alignment.Center) {
            Glyph(EnsoIcon.ArrowUp, Modifier.size(22.dp), if (busy || text.isBlank()) c.dim else c.pillInk)
        }
    }
}

// The desktop policy rejects longer page text; keep the field from ever building an invalid request.
private const val PREVIEW_TEXT_LIMIT = 2_000

@Composable
private fun PreviewIconButton(icon: EnsoIcon, label: String, enabled: Boolean, onClick: () -> Unit) {
    val c = Enso.colors
    Box(Modifier.size(40.dp).clip(CircleShape).clickable(enabled, role = Role.Button, onClick = onClick)
        .semantics { contentDescription = label }, contentAlignment = Alignment.Center) {
        Glyph(icon, Modifier.size(20.dp), if (enabled) c.ink2 else c.faint)
    }
}

private fun decodeFrame(dataUrl: String): android.graphics.Bitmap? {
    val comma = dataUrl.indexOf(',').takeIf { it > 0 } ?: return null
    val bytes = runCatching { Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT) }.getOrNull() ?: return null
    return runCatching { BitmapFactory.decodeByteArray(bytes, 0, bytes.size) }.getOrNull()
}
