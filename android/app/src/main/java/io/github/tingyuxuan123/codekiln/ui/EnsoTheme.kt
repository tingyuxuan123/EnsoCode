package io.github.tingyuxuan123.eaves.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.PlatformTextStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.tingyuxuan123.eaves.R

@Immutable
internal data class EnsoColors(
    val dark: Boolean,
    val page: Color,
    val card: Color,
    val card2: Color,
    val line: Color,
    val ink: Color,
    val ink2: Color,
    val dim: Color,
    val faint: Color,
    val pill: Color,
    val pillInk: Color,
    val blue: Color,
    val yellow: Color,
    val red: Color,
    val green: Color,
    val dawn: Color,
    val dawnSide: Color,
    val greetStart: Color,
    val greetEnd: Color,
    val camera: Color = Color(0xFF101215),
)

// Light tokens are sourced from ensocode-android.vetd/theme.css; dark pairs from §5.1.
private val Light = EnsoColors(
    dark = false,
    page = Color(0xFFF4F5F7), card = Color.White, card2 = Color(0xFFF0F1F3),
    line = Color(0xFFE3E5E8), ink = Color(0xFF0B0C0E), ink2 = Color(0xFF3F444B),
    dim = Color(0xFF6B7077), faint = Color(0xFF9AA0A6), pill = Color(0xFF0B0C0E),
    pillInk = Color.White, blue = Color(0xFF2563EB), yellow = Color(0xFFE0A100),
    red = Color(0xFFDC2626), green = Color(0xFF16A34A), dawn = Color(0xFFD6E2FB),
    dawnSide = Color(0xFFE6DEFA), greetStart = Color(0xFF6D3FD6), greetEnd = Color(0xFF2F55D4),
)

private val Dark = EnsoColors(
    dark = true,
    page = Color(0xFF0A0B0D), card = Color(0xFF15171A), card2 = Color(0xFF1C1F23),
    line = Color(0xFF24272C), ink = Color(0xFFF4F5F6), ink2 = Color(0xFFB3B8BE),
    dim = Color(0xFF8B9096), faint = Color(0xFF5B6067), pill = Color(0xFFF4F5F6),
    pillInk = Color(0xFF0A0B0D), blue = Color(0xFF3B82F6), yellow = Color(0xFFFACC15),
    red = Color(0xFFF0524F), green = Color(0xFF22C55E), dawn = Color(0xFF13235E),
    dawnSide = Color(0xFF1C1A52), greetStart = Color(0xFFB89AFF), greetEnd = Color(0xFF8EA8FF),
)

private val LocalEnsoColors = staticCompositionLocalOf { Light }

internal object Enso {
    val colors: EnsoColors @Composable get() = LocalEnsoColors.current
    val pillShape = RoundedCornerShape(percent = 50)
    val composerShape = RoundedCornerShape(24.dp)
    val sheetShape = RoundedCornerShape(26.dp)
    val cameraShape = RoundedCornerShape(28.dp)
    val mono = FontFamily(Font(R.font.jetbrains_mono_regular))
}

internal fun ensoText(
    size: Int,
    line: Int,
    weight: FontWeight = FontWeight.Normal,
    font: FontFamily = FontFamily.SansSerif,
) = TextStyle(
    fontFamily = font,
    fontSize = size.sp,
    lineHeight = line.sp,
    fontWeight = weight,
    platformStyle = PlatformTextStyle(includeFontPadding = false),
    lineHeightStyle = LineHeightStyle(
        alignment = LineHeightStyle.Alignment.Center,
        trim = LineHeightStyle.Trim.None,
        mode = LineHeightStyle.Mode.Fixed,
    ),
)

@Composable
internal fun EnsoTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    val colors = if (dark) Dark else Light
    val scheme = if (dark) darkColorScheme(
        primary = colors.ink, onPrimary = colors.pillInk, background = colors.page,
        surface = colors.card, onSurface = colors.ink,
    ) else lightColorScheme(
        primary = colors.ink, onPrimary = colors.pillInk, background = colors.page,
        surface = colors.card, onSurface = colors.ink,
    )
    CompositionLocalProvider(LocalEnsoColors provides colors) {
        MaterialTheme(colorScheme = scheme, content = content)
    }
}
