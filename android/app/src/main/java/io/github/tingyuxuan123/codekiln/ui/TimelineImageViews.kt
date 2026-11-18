package io.github.tingyuxuan123.eaves.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog

/**
 * Timeline images come from the authoritative projection, so they render from the message bytes.
 * A missing or undecodable payload keeps an explicit placeholder instead of a broken frame.
 */
@Composable
internal fun TimelineImageStrip(images: List<TimelineImage>, modifier: Modifier = Modifier) {
    val c = Enso.colors
    var opened by remember { mutableStateOf<TimelineImage?>(null) }
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        images.take(4).forEachIndexed { index, image ->
            val bitmap = remember(image.data) { decodeTimelineImage(image, maxEdge = 320) }
            val shape = RoundedCornerShape(14.dp)
            if (bitmap == null) {
                Box(Modifier.size(96.dp).clip(shape).background(c.card2), contentAlignment = Alignment.Center) {
                    Label("图片无法显示", 11, 14, color = c.dim)
                }
            } else {
                Image(bitmap.asImageBitmap(), contentDescription = "查看图片 ${index + 1}",
                    modifier = Modifier.size(96.dp).clip(shape).clickable(role = Role.Button) { opened = image },
                    contentScale = ContentScale.Crop)
            }
        }
        if (images.size > 4) Box(Modifier.size(96.dp).clip(RoundedCornerShape(14.dp)).background(c.card2),
            contentAlignment = Alignment.Center) { Label("+${images.size - 4}", 13, 18, color = c.dim) }
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
