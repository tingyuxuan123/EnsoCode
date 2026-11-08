package io.github.tingyuxuan123.eaves.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Text
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import io.github.tingyuxuan123.eaves.R

/** The manual LAN fields are an inert design specimen, not an alternate pairing protocol. */
internal data class PairSpecimen(val address: String, val code: String)

internal data class PairUiState(
    val busy: Boolean = false,
    val paired: Boolean = false,
    val status: String? = null,
    val computer: String? = null,
    val error: String? = null,
    val resetRequired: Boolean = false,
    val watchActive: Boolean = false,
    val watchStarting: Boolean = false,
    val watchFailed: Boolean = false,
)

@Composable
internal fun PairScreen(
    onClose: () -> Unit,
    specimen: PairSpecimen? = null,
    state: PairUiState = PairUiState(),
    link: String = "",
    onLink: (String) -> Unit = {},
    onPair: (() -> Unit)? = null,
    onReconnect: (() -> Unit)? = null,
    onUnpair: (() -> Unit)? = null,
    scanner: (@Composable () -> Unit)? = null,
    onWatch: (() -> Unit)? = null,
    onNotificationSettings: (() -> Unit)? = null,
) {
    val c = Enso.colors
    var confirmUnpair by remember { mutableStateOf(false) }
    if (confirmUnpair) AlertDialog(
        onDismissRequest = { confirmUnpair = false },
        title = { Label(if (state.resetRequired) "清理失效记录？" else "解绑电脑？", 17, 22) },
        text = { Label(if (state.resetRequired) "只清除此手机的失效记录。电脑端的旧授权可以在电脑设置中删除。" else "解绑后需要重新扫描电脑上的二维码。", 14, 20) },
        confirmButton = { TextButton(onClick = { confirmUnpair = false; onUnpair?.invoke() }) {
            Text(if (state.resetRequired) "确认清理" else "确认解绑")
        } },
        dismissButton = { TextButton(onClick = { confirmUnpair = false }) { Text("取消") } },
    )
    Column(Modifier.fillMaxSize().background(c.page).designTopInset().designBottomInset(36.dp).imePadding()) {
        TopBar("连接电脑", EnsoIcon.Close, "关闭", onClose)
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState())
            .padding(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 12.dp)) {
            ScannerGuide(paired = state.paired, scanner = if (specimen == null && !state.paired && !state.busy) scanner else null)
            Label(if (state.paired) if (state.watchActive) "配对已保存。后台提醒已开启，离开应用后仍会保持连接。"
                else "配对已保存在这台手机上。未开启后台提醒时，离开应用会暂停连接。"
                else "在电脑上打开 Eaves → 设置 → 手机，扫描出现的二维码即可配对。", 15, 22,
                Modifier.padding(start = 4.dp, end = 4.dp, top = 16.dp), color = c.ink2)
            if (specimen == null) {
                if (state.paired) {
                    Label(state.computer ?: "已配对电脑", 17, 22, Modifier.padding(start = 4.dp, top = 28.dp),
                        weight = FontWeight.Medium)
                    Label(state.status ?: "正在连接", 14, 20, Modifier.padding(start = 4.dp, top = 8.dp), color = c.dim)
                    Row(Modifier.padding(top = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        PairAction("重新连接", onReconnect?.takeUnless { state.busy })
                        PairAction(if (state.resetRequired) "清理失效记录" else "解绑电脑",
                            if (state.busy || onUnpair == null) null else { { confirmUnpair = true } })
                    }
                    if (onWatch != null && !state.resetRequired) {
                        Label("后台提醒", 15, 20, Modifier.padding(start = 4.dp, top = 22.dp), weight = FontWeight.SemiBold)
                        Label("保持与电脑的连接，在系统通知中提醒待审批、待回答和任务结束。可随时停止。", 13, 20,
                            Modifier.padding(start = 4.dp, top = 6.dp), color = c.dim)
                        Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            PairAction(when {
                                state.watchStarting -> "正在开启…"
                                state.watchActive -> "停止后台连接"
                                else -> "开启后台提醒"
                            }, onWatch.takeUnless { state.busy || state.watchStarting })
                            PairAction("通知设置", onNotificationSettings)
                        }
                        if (state.watchFailed) Label("后台连接未开启，请检查通知权限后重试。", 13, 20,
                            Modifier.padding(start = 4.dp, top = 6.dp), color = c.red)
                    }
                } else {
                    Label("或粘贴配对链接", 15, 20, Modifier.padding(start = 4.dp, top = 28.dp),
                        color = c.dim, weight = FontWeight.SemiBold)
                    Label("电脑上显示的二维码链接", 12, 16, Modifier.padding(start = 4.dp, top = 12.dp), color = c.dim)
                    Row(Modifier.padding(top = 6.dp).fillMaxWidth().height(48.dp).clip(Enso.composerShape)
                        .background(c.card).border(1.dp, c.line, Enso.composerShape).padding(horizontal = 16.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Glyph(EnsoIcon.Laptop, Modifier.size(18.dp), c.dim)
                        BasicTextField(link, onLink, Modifier.weight(1f).semantics { contentDescription = "配对链接" },
                            enabled = !state.busy, singleLine = true, textStyle = ensoText(14, 20).copy(color = c.ink),
                            cursorBrush = Brush.verticalGradient(listOf(c.ink, c.ink)),
                            decorationBox = { input ->
                                Box {
                                    if (link.isEmpty()) Label("enso://pair?… 或 https://…", 14, 20, color = c.faint, maxLines = 1)
                                    input()
                                }
                            })
                    }
                    Row(Modifier.padding(start = 4.dp, top = 12.dp), verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Glyph(EnsoIcon.Lock, Modifier.size(14.dp), c.dim)
                        Label("端到端加密，中继只转发密文", 12, 16, color = c.dim)
                    }
                    if (state.busy) Label("正在安全配对…", 14, 20, Modifier.padding(start = 4.dp, top = 16.dp), color = c.dim)
                }
                state.error?.let { error ->
                    Label(error, 14, 20, Modifier.padding(start = 4.dp, top = 16.dp), color = c.red)
                }
                if (state.resetRequired && !state.paired) PairAction("清理失效记录",
                    if (state.busy || onUnpair == null) null else { { confirmUnpair = true } })
            } else {
                ManualPairSpecimen(specimen)
            }
        }
        val canPair = specimen == null && !state.busy && !state.paired && !state.resetRequired && link.isNotBlank() && onPair != null
        Row(Modifier.padding(start = 20.dp, end = 20.dp, top = 12.dp)
            .fillMaxWidth().height(56.dp).glass(inverted = true, opacity = if (canPair || specimen != null) 1f else .55f)
            .clickable(enabled = canPair, role = Role.Button) { onPair?.invoke() },
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center) {
            Glyph(EnsoIcon.Link, Modifier.size(20.dp), c.pillInk)
            Label(if (state.busy) "处理中…" else if (state.paired) "已配对" else "配对", 16, 22,
                Modifier.padding(start = 8.dp), color = c.pillInk, weight = FontWeight.Medium)
        }
    }
}

@Composable
private fun ScannerGuide(paired: Boolean = false, scanner: (@Composable () -> Unit)? = null) {
    Box(Modifier.fillMaxWidth().height(300.dp).clip(Enso.cameraShape).background(Enso.colors.camera)
        .border(.75.dp, Brush.verticalGradient(listOf(Color.White.copy(alpha = .08f), Color.Transparent)), Enso.cameraShape)) {
        scanner?.invoke()
        Canvas(Modifier.matchParentSize()) {
            radial(Color.White.copy(alpha = .07f), size.width * .5f, size.height * .45f,
                size.width * .7f, size.height * .6f, .7f)
            val inset = 21.5.dp.toPx()
            val length = 42.5.dp.toPx()
            val radius = 14.5.dp.toPx()
            for (horizontal in listOf(1f, -1f)) for (vertical in listOf(1f, -1f)) {
                val x = if (horizontal > 0) inset else size.width - inset
                val y = if (vertical > 0) inset else size.height - inset
                val corner = Path().apply {
                    moveTo(x, y + length * vertical)
                    lineTo(x, y + radius * vertical)
                    quadraticTo(x, y, x + radius * horizontal, y)
                    lineTo(x + length * horizontal, y)
                }
                drawPath(corner, Color.White.copy(alpha = .9f), style = Stroke(3.dp.toPx()))
            }
            val lineLeft = 48.dp.toPx()
            val lineRight = size.width - lineLeft
            if (lineRight > lineLeft) drawRect(
                Brush.horizontalGradient(listOf(Color.Transparent, Color.White.copy(alpha = .7f), Color.Transparent), lineLeft, lineRight),
                topLeft = Offset(lineLeft, size.height * .46f), size = Size(lineRight - lineLeft, 1.dp.toPx()),
            )
        }
        Column(Modifier.align(Alignment.BottomCenter).padding(bottom = 36.dp),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Image(painterResource(R.drawable.eaves_mark), null, Modifier.size(22.dp),
                colorFilter = ColorFilter.tint(Color.White.copy(alpha = .6f)))
            Label(if (paired) "端到端加密配对" else "对准电脑上的二维码", 13, 18, color = Color.White.copy(alpha = .75f))
        }
    }
}

@Composable
private fun PairAction(title: String, onClick: (() -> Unit)?) {
    Label(title, 14, 20, Modifier.height(40.dp).glass().clickable(enabled = onClick != null) { onClick?.invoke() }
        .padding(horizontal = 16.dp, vertical = 10.dp), weight = FontWeight.Medium)
}

@Composable
private fun ManualPairSpecimen(specimen: PairSpecimen) {
    val c = Enso.colors
    Label("或手动连接", 15, 20, Modifier.padding(start = 4.dp, top = 28.dp), c.dim, FontWeight.SemiBold)
    Label("电脑的局域网地址", 12, 16, Modifier.padding(start = 4.dp, top = 12.dp), c.dim)
    Row(Modifier.padding(top = 6.dp).fillMaxWidth().height(48.dp).clip(Enso.composerShape).background(c.card)
        .border(1.dp, c.line, Enso.composerShape).padding(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        Glyph(EnsoIcon.Laptop, Modifier.size(18.dp), c.dim)
        Text(specimen.address, color = c.ink, style = ensoText(15, 20, font = Enso.mono))
    }
    Label("电脑上显示的 6 位验证码", 12, 16, Modifier.padding(start = 4.dp, top = 16.dp), c.dim)
    Row(Modifier.padding(top = 6.dp).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        for (index in 0..5) {
            val digit = specimen.code.getOrNull(index)
            val shape = androidx.compose.foundation.shape.RoundedCornerShape(14.dp)
            Box(Modifier.weight(1f).height(52.dp).background(c.card, shape)
                .then(if (digit == null) Modifier.border(1.5.dp, c.ink, shape) else Modifier),
                contentAlignment = Alignment.Center) {
                if (digit == null) Box(Modifier.size(2.dp, 24.dp).background(c.ink))
                else Text(digit.toString(), color = c.ink, style = ensoText(22, 26, FontWeight.Medium, Enso.mono))
            }
        }
    }
    Row(Modifier.padding(start = 4.dp, top = 12.dp), verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Glyph(EnsoIcon.Lock, Modifier.size(14.dp), c.dim)
        Label("端到端加密，中继只转发密文", 12, 16, color = c.dim)
    }
}
