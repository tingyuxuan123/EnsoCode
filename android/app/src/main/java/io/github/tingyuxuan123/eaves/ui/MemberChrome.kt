package io.github.tingyuxuan123.eaves.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.github.tingyuxuan123.eaves.mirror.DesktopBotMember
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

@Composable
internal fun MemberAvatar(member: DesktopBotMember?, size: Dp, modifier: Modifier = Modifier, ring: Boolean = false,
    status: Boolean = size >= 32.dp) {
    val c = Enso.colors
    val name = member?.name.orEmpty()
    val tint = remember(member?.avatarColor, c.dim) {
        val hex = member?.avatarColor?.takeIf { it.startsWith('#') }?.drop(1)
        val rgb = when (hex?.length) {
            3 -> hex.map { "$it$it" }.joinToString("").toLongOrNull(16)
            6 -> hex.toLongOrNull(16)
            else -> null
        }
        rgb?.let { Color(0xff000000 or it) } ?: c.dim
    }
    Box(modifier.size(size).semantics { if (name.isNotEmpty()) contentDescription = "${name}头像" },
        contentAlignment = Alignment.Center) {
        Box(Modifier.matchParentSize().background(tint, CircleShape)
            .then(if (ring) Modifier.border(2.dp, c.page, CircleShape) else Modifier))
        if (size >= 26.dp && name.isNotEmpty()) {
            val first = name.substring(0, name.offsetByCodePoints(0, 1))
            Label(first, (size.value * .4f).toInt(), size.value.toInt(), color = Color.White,
                weight = FontWeight.SemiBold, maxLines = 1)
        } else if (member == null) Glyph(EnsoIcon.Users, Modifier.size(size * .46f), Color.White)
        if (status && member != null) Box(Modifier.align(Alignment.BottomEnd).size(10.dp)
            .background(if (member.status == "running") c.blue else c.faint, CircleShape)
            .border(2.dp, c.page, CircleShape))
    }
}

@Composable
internal fun GroupAvatars(members: List<DesktopBotMember>, diagonal: Boolean = false) {
    if (diagonal) Box(Modifier.size(44.dp)) {
        if (members.size < 2) MemberAvatar(members.firstOrNull(), 40.dp, Modifier.align(Alignment.Center), status = false)
        else {
            MemberAvatar(members[0], 28.dp, Modifier.align(Alignment.TopStart), ring = true)
            MemberAvatar(members[1], 28.dp, Modifier.align(Alignment.BottomEnd), ring = true)
        }
    } else if (members.isNotEmpty()) {
        val shown = members.take(4)
        Box(Modifier.size(height = 26.dp, width = (26 + (shown.size - 1) * 18).dp)) {
            shown.forEachIndexed { index, member -> MemberAvatar(member, 26.dp, Modifier.offset(x = (index * 18).dp), ring = true) }
        }
    }
}

@Composable
internal fun MemberBubble(content: @Composable () -> Unit) {
    val c = Enso.colors
    Row(Modifier.fillMaxWidth().padding(start = 48.dp, bottom = 20.dp), horizontalArrangement = Arrangement.End) {
        androidx.compose.foundation.layout.Column(Modifier.background(c.pill,
            RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp, bottomStart = 20.dp, bottomEnd = 6.dp))
            .padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) { content() }
    }
}

@Composable
internal fun MembersHint(text: String, modifier: Modifier = Modifier) = Label(text, 13, 18,
    modifier.padding(horizontal = 20.dp, vertical = 8.dp), color = Enso.colors.dim)

internal fun memberTime(at: Long, now: Long = System.currentTimeMillis()): String {
    val minutes = (now - at).coerceAtLeast(0) / 60_000
    val zone = ZoneId.systemDefault()
    val date = Instant.ofEpochMilli(at).atZone(zone).toLocalDate()
    val today = Instant.ofEpochMilli(now).atZone(zone).toLocalDate()
    return when {
        minutes < 1 -> "刚刚"
        minutes < 60 -> "$minutes 分钟前"
        date == today -> memberClock(at)
        date == today.minusDays(1) -> "昨天"
        else -> date.format(DateTimeFormatter.ofPattern("M月d日", Locale.CHINA))
    }
}

internal fun memberClock(at: Long): String = Instant.ofEpochMilli(at).atZone(ZoneId.systemDefault())
    .format(DateTimeFormatter.ofPattern("HH:mm", Locale.ROOT))

internal fun memberDate(at: Long, now: Long = System.currentTimeMillis()): String {
    val zone = ZoneId.systemDefault()
    val date = Instant.ofEpochMilli(at).atZone(zone).toLocalDate()
    val today = Instant.ofEpochMilli(now).atZone(zone).toLocalDate()
    val day = when (date) {
        today -> "今天"
        today.minusDays(1) -> "昨天"
        else -> date.format(DateTimeFormatter.ofPattern("M月d日", Locale.CHINA))
    }
    return "$day ${memberClock(at)}"
}
