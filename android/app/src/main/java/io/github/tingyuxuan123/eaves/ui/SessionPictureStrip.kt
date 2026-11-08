package io.github.tingyuxuan123.eaves.ui

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp

@Composable
internal fun SessionPictureStrip(draft: PictureDraftState, canRemove: Boolean, onRemove: (String) -> Unit) {
    val c = Enso.colors
    if (draft.pictures.isNotEmpty()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            draft.pictures.forEachIndexed { index, picture ->
                val image = remember(picture.id) { BitmapFactory.decodeByteArray(picture.thumbnail, 0, picture.thumbnail.size)?.asImageBitmap() }
                Box(Modifier.size(64.dp).clip(RoundedCornerShape(14.dp)).background(c.card2)) {
                    if (image != null) Image(image, "待发送图片 ${index + 1}", Modifier.matchParentSize(), contentScale = ContentScale.Crop)
                    GlyphButton(EnsoIcon.Close, "移除图片 ${index + 1}", 36.dp, 16.dp,
                        Modifier.align(Alignment.TopEnd).glass(inverted = true), c.pillInk,
                        onClick = if (canRemove) ({ onRemove(picture.id) }) else null)
                }
            }
        }
    }
    val notice = if (draft.loading) "正在处理图片…" else draft.error
    if (notice != null) Label(notice, 12, 16, Modifier.padding(horizontal = 16.dp, vertical = 4.dp), color = if (draft.loading) c.dim else c.red)
}
