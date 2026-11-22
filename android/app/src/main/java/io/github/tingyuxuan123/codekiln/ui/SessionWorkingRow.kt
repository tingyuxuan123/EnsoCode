package io.github.tingyuxuan123.codekiln.ui

import android.animation.ValueAnimator
import android.os.SystemClock
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlin.math.sin

private data class WorkingPhrase(val text: String, val fullText: String)

/** The timeline footer, not a chat message: it disappears when the observed run ends. */
@Composable
internal fun SessionWorkingRow(status: SessionWorkingStatus, since: Long?) {
    val c = Enso.colors
    val motion = ValueAnimator.areAnimatorsEnabled() && status.showElapsed
    Row(Modifier.fillMaxWidth().heightIn(min = 34.dp).padding(bottom = 5.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        WorkingSpark(motion)
        val first = status.phrases.first()
        val phrase by produceState(WorkingPhrase(first, first), status.phrases, motion) {
            if (!motion) {
                value = WorkingPhrase("$first…", first)
                return@produceState
            }
            var index = 0
            while (true) {
                val text = status.phrases[index]
                // Reveal complete code points so a truncated filename never flashes half an emoji.
                var end = 0
                while (end < text.length) {
                    end = text.offsetByCodePoints(end, 1)
                    value = WorkingPhrase(text.substring(0, end), text)
                    delay(38)
                }
                repeat(2) {
                    for (dots in 0..3) {
                        value = WorkingPhrase(text + ".".repeat(dots), text)
                        delay(390)
                    }
                }
                index = (index + 1) % status.phrases.size
            }
        }
        Label(phrase.text, 14, 20, Modifier.weight(1f, fill = false).clearAndSetSemantics {
            liveRegion = LiveRegionMode.Polite
            contentDescription = "工作状态：${phrase.fullText}"
        }, color = c.ink2, maxLines = 1)
        if (since != null && status.showElapsed) WorkingElapsed(since)
    }
}

@Composable
private fun WorkingElapsed(since: Long) {
    // Draw timing from a monotonic clock. A server clock offset cannot make this negative or jump.
    val elapsed by produceState(0L, since) {
        while (true) {
            value = (SystemClock.elapsedRealtime() - since).coerceAtLeast(0)
            delay(1_000 - value % 1_000)
        }
    }
    Label("·", 12, 18, color = Enso.colors.faint)
    Label(formatWorkingElapsed(elapsed), 12, 18, color = Enso.colors.dim, maxLines = 1)
}

/** Two interleaved petal triads from PC's CodeKilnWorkingIcon; only the small canvas animates. */
@Composable
private fun WorkingSpark(motion: Boolean) {
    // Desktop's amber brand palette in renderer/styles/shared.css.
    val gold = if (Enso.colors.dark) Color(0xFFE6B254) else Color(0xFFB4740C)
    val primary = remember { workingPetal(9.4f, 2.05f, .48f) }
    val secondary = remember { workingPetal(8.85f, 1.72f, .4f) }
    val aura = remember(gold) { Brush.radialGradient(listOf(gold.copy(alpha = .22f), gold.copy(alpha = 0f)),
        center = Offset.Zero, radius = 12f) }
    val angle = if (motion) rememberInfiniteTransition(label = "working spark").animateFloat(
        initialValue = 0f, targetValue = 360f,
        animationSpec = infiniteRepeatable(tween(2400, easing = LinearEasing)), label = "spark turn",
    ) else null
    Canvas(Modifier.size(22.dp)) {
        val spin = angle?.value ?: 0f
        val bloom = if (motion) .92f + .08f * sin(spin * (Math.PI / 180)).toFloat() else 1f
        val factor = size.minDimension / 27f
        withTransform({
            translate(center.x, center.y)
            scale(factor, factor, Offset.Zero)
        }) {
            drawCircle(aura, 12f, Offset.Zero)
            scale(bloom, pivot = Offset.Zero) {
                for (index in 0..2) {
                    rotate(spin + index * 120f + 60f, Offset.Zero) { drawPath(secondary, gold, alpha = .57f) }
                    rotate(spin + index * 120f, Offset.Zero) { drawPath(primary, gold, alpha = .88f) }
                }
                drawCircle(gold, 2.1f, Offset.Zero)
                drawCircle(Color.White.copy(alpha = .68f), .67f, Offset.Zero)
            }
        }
    }
}

private fun workingPetal(length: Float, bulb: Float, neck: Float): Path = Path().apply {
    val stem = length - bulb
    moveTo(0f, 0f)
    cubicTo(-neck, -stem * .44f, -bulb, -stem * .72f, -bulb, -stem)
    cubicTo(-bulb, -length - .65f, bulb, -length - .65f, bulb, -stem)
    cubicTo(bulb, -stem * .72f, neck, -stem * .44f, 0f, 0f)
    close()
}
