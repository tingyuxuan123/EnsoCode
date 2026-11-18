package io.github.tingyuxuan123.eaves.ui

/**
 * Compact token labels never round a value up into the next unit, so a bar or badge cannot
 * overstate what the desktop actually reported. Truncation is done in integer math.
 */
internal fun tokenCount(value: Long): String {
    if (value < 0) return "—"
    if (value < 1_000) return value.toString()
    return when {
        value >= 1_000_000_000_000L -> scaled(value, 1_000_000_000_000L, 2, "T")
        value >= 1_000_000_000L -> scaled(value, 1_000_000_000L, 2, "B")
        value >= 1_000_000L -> scaled(value, 1_000_000L, 2, "M")
        else -> scaled(value, 1_000L, 1, "K")
    }
}

private fun scaled(value: Long, unit: Long, places: Int, suffix: String): String {
    val scale = if (places == 1) 10L else 100L
    val whole = value / unit
    val fraction = (value % unit) * scale / unit
    val digits = fraction.toString().padStart(places, '0').trimEnd('0')
    return if (digits.isEmpty()) "$whole$suffix" else "$whole.$digits$suffix"
}

/** Unknown windows stay unknown; a tiny non-zero usage still shows as one percent, never zero. */
internal fun contextPercent(used: Long, window: Long?): Int? {
    if (window == null || window <= 0 || used < 0) return null
    val percent = (used.coerceAtMost(Long.MAX_VALUE / 100) * 100 / window).coerceIn(0, 100).toInt()
    return if (used > 0) percent.coerceAtLeast(1) else 0
}
