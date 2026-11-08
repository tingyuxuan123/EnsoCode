package io.github.tingyuxuan123.eaves.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp

// Keep the canvas's vertical rhythm without painting fake status or gesture bars.
@Composable
internal fun Modifier.designTopInset(): Modifier {
    val density = LocalDensity.current
    val system = with(density) { WindowInsets.statusBars.getTop(density).toDp() }
    return statusBarsPadding().padding(top = (47.dp - system).coerceAtLeast(0.dp))
}

@Composable
internal fun Modifier.designBottomInset(minimum: Dp): Modifier {
    val density = LocalDensity.current
    val system = with(density) { WindowInsets.navigationBars.getBottom(density).toDp() }
    return navigationBarsPadding().padding(bottom = (minimum - system).coerceAtLeast(0.dp))
}

@Composable
internal fun Label(
    text: String,
    size: Int,
    line: Int,
    modifier: Modifier = Modifier,
    color: Color = Enso.colors.ink,
    weight: FontWeight = FontWeight.Normal,
    maxLines: Int = Int.MAX_VALUE,
) = Text(
    text, modifier, color = color, style = ensoText(size, line, weight),
    maxLines = maxLines, overflow = TextOverflow.Ellipsis,
)

@Composable
internal fun Modifier.glass(shape: Shape = CircleShape, inverted: Boolean = false, opacity: Float = 1f): Modifier {
    val c = Enso.colors
    val top = if (c.dark || inverted) Color.White.copy(alpha = .16f) else Color.White
    val bottom = if (c.dark || inverted) Color.White.copy(alpha = .04f) else Color.Black.copy(alpha = .05f)
    val fill = when {
        inverted -> c.pill
        c.dark -> c.card2.copy(alpha = .82f)
        else -> c.card.copy(alpha = .86f)
    }
    val shadowed = if (c.dark) this else this
        .dropShadow(shape, Shadow(radius = 24.dp, spread = (-8).dp,
            offset = DpOffset(0.dp, 10.dp), color = Color.Black, alpha = opacity * if (inverted) .30f else .16f))
        .dropShadow(shape, Shadow(radius = 6.dp, offset = DpOffset(0.dp, 2.dp),
            color = Color.Black, alpha = opacity * if (inverted) .08f else .05f))
    return shadowed
        .clip(shape)
        .background(fill.copy(alpha = fill.alpha * opacity))
        .border(.75.dp, Brush.verticalGradient(listOf(top.copy(alpha = top.alpha * opacity),
            bottom.copy(alpha = bottom.alpha * opacity))), shape)
}

@Composable
internal fun GlyphButton(
    icon: EnsoIcon,
    label: String,
    size: Dp,
    glyphSize: Dp,
    modifier: Modifier = Modifier,
    tint: Color = Enso.colors.ink,
    onClick: (() -> Unit)? = null,
) {
    Box(
        modifier.size(size).clip(CircleShape)
            .semantics { contentDescription = label }
            .clickable(enabled = onClick != null, role = Role.Button) { onClick?.invoke() },
        contentAlignment = Alignment.Center,
    ) { Glyph(icon, Modifier.size(glyphSize), color = tint) }
}

@Composable
internal fun TopBar(
    title: String,
    lead: EnsoIcon,
    leadLabel: String,
    onLead: () -> Unit,
    detail: String? = null,
    showMenu: Boolean = false,
    trailing: (@Composable () -> Unit)? = null,
) {
    Row(
        Modifier.fillMaxWidth().height(56.dp).padding(start = 4.dp, end = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        GlyphButton(lead, leadLabel, 48.dp, 24.dp, onClick = onLead)
        Column(Modifier.weight(1f)) {
            Label(title, 17, 22, weight = FontWeight.Medium, maxLines = 1)
            if (detail != null) Row(verticalAlignment = Alignment.CenterVertically) {
                Label(detail, 12, 16, color = Enso.colors.dim, maxLines = 1)
                if (showMenu) Glyph(EnsoIcon.Down, Modifier.size(14.dp), Enso.colors.dim)
            }
        }
        trailing?.invoke()
    }
}

@Composable
internal fun SessionMeta(project: String?, time: String, modifier: Modifier = Modifier) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        if (project != null) {
            Glyph(EnsoIcon.Folder, Modifier.size(12.dp), Enso.colors.ink2)
            Label(project, 12, 16, Modifier.padding(start = 4.dp, end = 10.dp).weight(1f, fill = false),
                color = Enso.colors.ink2, maxLines = 1)
        }
        Label(time, 12, 16, color = Enso.colors.ink2, maxLines = 1)
    }
}

@Composable
internal fun Hairline(modifier: Modifier = Modifier) {
    Spacer(modifier.fillMaxWidth().height(.75.dp).background(Enso.colors.line))
}

@Composable
internal fun BoxScope.Dawn() {
    val c = Enso.colors
    Canvas(Modifier.align(Alignment.TopCenter).fillMaxWidth().height(560.dp)) {
        radial(c.dawn, size.width, size.height * .06f, size.width * .85f, size.height * .58f, .72f)
        radial(c.dawnSide, 0f, 0f, size.width * .90f, size.height * .62f, .70f)
    }
}

@Composable
internal fun BoxScope.HomeGlow() {
    val c = Enso.colors
    Canvas(Modifier.align(Alignment.TopCenter).fillMaxWidth().height(420.dp)) {
        radial(c.card, size.width * .5f, 0f, size.width * .8f, size.height, 1f)
    }
}

internal fun DrawScope.radial(color: Color, x: Float, y: Float, rx: Float, ry: Float, fade: Float) {
    if (rx <= 0 || ry <= 0) return
    val center = Offset(x, y)
    scale(1f, ry / rx, center) {
        drawCircle(
            Brush.radialGradient(0f to color, fade to color.copy(alpha = 0f), center = center, radius = rx),
            radius = rx * fade,
            center = center,
        )
    }
}
