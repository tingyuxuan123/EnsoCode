package io.github.tingyuxuan123.eaves.ui

import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.unit.dp

// Exact path data from the design's Iconify lucide (ISC) and mdi (Apache-2.0) icons.
// See android/NOTICE. No full icon library is bundled.
internal enum class EnsoIcon(val paths: String, val solid: Boolean = false) {
    Menu("M4 5h16M4 12h16M4 19h16"),
    Close("M18 6L6 18M6 6l12 12"),
    Folder("M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"),
    Chevrons("m7 15l5 5l5-5M7 9l5-5l5 5"),
    Down("m6 9l6 6l6-6"),
    Right("m9 18l6-6l-6-6"),
    Back("m15 18l-6-6l6-6"),
    Plus("M5 12h14m-7-7v14"),
    Mic("M12 19v3m7-12v2a7 7 0 0 1-14 0v-2|M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3Z"),
    ArrowUp("m5 12l7-7l7 7m-7 7V5"),
    Sliders("M21 4h-7M10 4H3m18 8H11M7 12H3m18 8h-7M10 20H3M14 2v4M7 10v4M14 18v4"),
    ListOrdered("M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M4 14h1.5a.5.5 0 0 1 .5.5V15a1 1 0 0 1-1 1 1 1 0 0 0-1 1v1h2"),
    Zap("M13 2 3 14h9l-1 8 10-12h-9l1-8Z"),
    Pencil("M21.174 6.812a1 1 0 0 0-3.986-3.986L4.842 15.174a2 2 0 0 0-.5.834L3.021 20.54a.5.5 0 0 0 .62.62l4.531-1.32a2 2 0 0 0 .834-.5l12.168-12.528M15 5l4 4"),
    Trash("M3 6h18M19 6v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6m3 0V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m-6 4v6m4-6v6"),
    Stop("M18 18H6V6h12z", true),
    Target("M22 12a10 10 0 1 1-20 0a10 10 0 1 1 20 0Z|M18 12a6 6 0 1 1-12 0a6 6 0 1 1 12 0Z|M14 12a2 2 0 1 1-4 0a2 2 0 1 1 4 0Z"),
    Pause("M15 3h3a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z|M6 3h3a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"),
    Play("M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"),
    ShieldCheck("M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z|m9 12l2 2l4-4"),
    Retry("M3 12a9 9 0 1 0 9-9a9.75 9.75 0 0 0-6.74 2.74L3 8|M3 3v5h5"),
    Compress("M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4"),
    Rewind("M9 14L4 9l5-5|M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"),
    Layers("m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z|m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65|m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"),
    Files("M20 7h-3a2 2 0 0 1-2-2V2|M9 18a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h7l4 4v10a2 2 0 0 1-2 2Z|M3 7.6v12.8A1.6 1.6 0 0 0 4.6 22h9.8"),
    Globe("M22 12a10 10 0 1 1-20 0a10 10 0 1 1 20 0Z|M2 12h20|M12 2a15.3 15.3 0 0 1 4 10a15.3 15.3 0 0 1-4 10a15.3 15.3 0 0 1-4-10a15.3 15.3 0 0 1 4-10Z"),
    Refresh("M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8|M21 3v5h-5"),
    NewTask("M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7|M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"),
    Board("M4 3h5a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z|M15 3h5a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z|M15 12h5a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Z|M4 16h5a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1Z"),
    Users("M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3.128a4 4 0 0 1 0 7.744M22 21v-2a4 4 0 0 0-3-3.87|M13 7a4 4 0 1 1-8 0a4 4 0 1 1 8 0Z"),
    Scan("M3 7V5a2 2 0 0 1 2-2h2m10 0h2a2 2 0 0 1 2 2v2m0 10v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2m4-5h10"),
    Search("m21 21l-4.34-4.34|M19 11a8 8 0 1 1-16 0a8 8 0 1 1 16 0Z"),
    Settings("M9.671 4.136a2.34 2.34 0 0 1 4.659 0a2.34 2.34 0 0 0 3.319 1.915a2.34 2.34 0 0 1 2.33 4.033a2.34 2.34 0 0 0 0 3.831a2.34 2.34 0 0 1-2.33 4.033a2.34 2.34 0 0 0-3.319 1.915a2.34 2.34 0 0 1-4.659 0a2.34 2.34 0 0 0-3.32-1.915a2.34 2.34 0 0 1-2.33-4.033a2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915|M15 12a3 3 0 1 1-6 0a3 3 0 1 1 6 0Z"),
    Inbox("M22 12h-6l-2 3h-4l-2-3H2|M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11"),
    Laptop("M18 5a2 2 0 0 1 2 2v8.526a2 2 0 0 0 .212.897l1.068 2.127a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45l1.068-2.127A2 2 0 0 0 4 15.526V7a2 2 0 0 1 2-2zm2.054 10.987H3.946"),
    Link("M9 17H7A5 5 0 0 1 7 7h2m6 0h2a5 5 0 1 1 0 10h-2m-7-5h8"),
    Lock("M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z|M7 11V7a5 5 0 0 1 10 0v4"),
    Check("M20 6L9 17l-5-5"),
    CircleCheck("M22 12a10 10 0 1 1-20 0a10 10 0 1 1 20 0Z|m9 12l2 2l4-4"),
    Terminal("m4 17l6-6l-6-6M12 19h8"),
    Timer("M10 2h4m-2 12l3-3|M20 14a8 8 0 1 1-16 0a8 8 0 0 1 16 0Z"),
    FileDiff("M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2zm3-12h6m-3 3V7M9 17h6"),
    Sort("m18 21l-4-4h3V7h-3l4-4l4 4h-3v10h3M2 19v-2h10v2M2 13v-2h7v2M2 7V5h4v2z", true),
    Pin("M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2z", true),
    Waiting("M10 19h3v3h-3zm2-17c5.35.22 7.68 5.62 4.5 9.67c-.83 1-2.17 1.66-2.83 2.5C13 15 13 16 13 17h-3c0-1.67 0-3.08.67-4.08c.66-1 2-1.59 2.83-2.25C15.92 8.43 15.32 5.26 12 5a3 3 0 0 0-3 3H6a6 6 0 0 1 6-6", true),
    Error("M10 3h4v11h-4zm0 18v-4h4v4z", true),
    More("M12 16a2 2 0 0 1 2 2a2 2 0 0 1-2 2a2 2 0 0 1-2-2a2 2 0 0 1 2-2m0-6a2 2 0 0 1 2 2a2 2 0 0 1-2 2a2 2 0 0 1-2-2a2 2 0 0 1 2-2m0-6a2 2 0 0 1 2 2a2 2 0 0 1-2 2a2 2 0 0 1-2-2a2 2 0 0 1 2-2", true);

    val vector: ImageVector by lazy {
        ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f).apply {
            paths.split('|').forEach { path ->
                addPath(
                    pathData = addPathNodes(path),
                    fill = if (solid) SolidColor(Color.Black) else null,
                    stroke = if (solid) null else SolidColor(Color.Black),
                    strokeLineWidth = 2f,
                    strokeLineCap = StrokeCap.Round,
                    strokeLineJoin = StrokeJoin.Round,
                )
            }
        }.build()
    }
}

@Composable
internal fun Glyph(
    icon: EnsoIcon,
    modifier: Modifier = Modifier,
    color: Color = Enso.colors.ink,
    label: String? = null,
) = Icon(icon.vector, contentDescription = label, modifier = modifier, tint = color)
