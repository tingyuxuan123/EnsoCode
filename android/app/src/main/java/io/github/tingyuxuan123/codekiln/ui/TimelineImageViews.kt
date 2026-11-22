package io.github.tingyuxuan123.codekiln.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import io.github.tingyuxuan123.codekiln.mirror.SessionImageTarget

/**
 * Timeline images come from the authoritative projection, so they render from the message bytes.
 * A missing or undecodable payload keeps an explicit placeholder instead of a broken frame.
 */
@Composable
internal fun TimelineImageStrip(images: List<TimelineImage>, modifier: Modifier = Modifier, compact: Boolean = false) {
    if (images.isEmpty()) return
    var opened by remember { mutableStateOf<TimelineImage?>(null) }
    BoxWithConstraints(modifier) {
        if (images.size == 1) {
            TimelineImageTile(images[0], 1, minOf(maxWidth, if (compact) 258.dp else 420.dp),
                if (compact) 158.dp else 226.dp) { opened = images[0] }
        } else {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp, if (compact) Alignment.End else Alignment.Start)) {
                itemsIndexed(images) { index, image ->
                    TimelineImageTile(image, index + 1, minOf(maxWidth, 152.dp), 118.dp) { opened = image }
                }
            }
        }
    }
    val full = opened
    if (full != null) {
        val bitmap = remember(full.data) { decodeTimelineImage(full) }
        Dialog(onDismissRequest = { opened = null }) {
            Box(Modifier.fillMaxSize().padding(12.dp), contentAlignment = Alignment.Center) {
                if (bitmap == null) {
                    Text("图片无法显示", color = Color.White)
                } else {
                    Image(bitmap.asImageBitmap(), contentDescription = "图片大图",
                        modifier = Modifier.fillMaxSize().clickable(role = Role.Button) { opened = null },
                        contentScale = ContentScale.Fit)
                }
            }
        }
    }
}

@Composable
private fun TimelineImageTile(image: TimelineImage, number: Int, maxWidth: Dp, maxHeight: Dp, open: () -> Unit) {
    val c = Enso.colors
    val shape = RoundedCornerShape(8.dp)
    val bitmap = remember(image) { decodeTimelineImage(image, maxEdge = 800) }
    if (bitmap == null) {
        Box(Modifier.size(minOf(122.dp, maxWidth), minOf(76.dp, maxHeight)).clip(shape).background(c.card2),
            contentAlignment = Alignment.Center) { Label("图片无法显示", 11, 14, color = c.dim) }
        return
    }
    val aspect = bitmap.width.toFloat() / bitmap.height
    val width = minOf(maxWidth, maxHeight * aspect).coerceAtLeast(minOf(52.dp, maxWidth))
    val height = minOf(maxHeight, width / aspect).coerceAtLeast(minOf(40.dp, maxHeight))
    Image(bitmap.asImageBitmap(), contentDescription = "查看图片 $number",
        modifier = Modifier.size(width, height).clip(shape).background(c.card2).border(.75.dp, c.line, shape)
            .clickable(role = Role.Button, onClick = open), contentScale = ContentScale.Fit)
}

@Composable
internal fun TimelineRemoteImage(target: SessionImageTarget, load: suspend (SessionImageTarget) -> String?) {
    var retry by remember(target) { mutableStateOf(0) }
    val result by produceState<Pair<Boolean, TimelineImage?>>(false to null, target, retry) {
        value = false to null
        val picture = load(target)?.let { TimelineImage(it.substringAfter(',', ""), it.substringBefore(',')
            .removePrefix("data:").removeSuffix(";base64")) }
        value = true to picture
    }
    val picture = result.second
    when {
        picture != null -> TimelineImageStrip(listOf(picture))
        !result.first -> SheetHint("正在读取桌面图片…")
        else -> Label("图片暂不可用 · 重试", 13, 18,
            Modifier.clickable(role = Role.Button) { retry++ }.padding(vertical = 6.dp), color = Enso.colors.blue)
    }
}
