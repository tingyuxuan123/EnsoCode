package io.github.tingyuxuan123.eaves

import android.content.ContentResolver
import android.accessibilityservice.AccessibilityServiceInfo
import android.content.ContentValues
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.SystemClock
import android.provider.MediaStore
import android.view.accessibility.AccessibilityNodeInfo
import android.graphics.Rect
import android.view.InputDevice
import android.view.MotionEvent
import androidx.test.platform.app.InstrumentationRegistry
import io.github.tingyuxuan123.eaves.ui.importSessionPictures
import java.util.UUID

/** The isolated emulator's picker must show the generated color pattern before we select anything. */
internal class PickerFixture(private val resolver: ContentResolver) : AutoCloseable {
    private val album = "Eaves smoke ${UUID.randomUUID().toString().take(8)}"
    private var uri: Uri? = null

    init {
        check(Build.VERSION.SDK_INT >= 33)
        val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, "eaves-fixture.png")
            put(MediaStore.Images.Media.MIME_TYPE, "image/png")
            put(MediaStore.Images.Media.RELATIVE_PATH, "${Environment.DIRECTORY_PICTURES}/$album")
            put(MediaStore.Images.Media.IS_PENDING, 1)
        }
        val inserted = requireNotNull(resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values))
        uri = inserted
        try {
            val bitmap = Bitmap.createBitmap(640, 420, Bitmap.Config.ARGB_8888)
            try {
                Canvas(bitmap).apply {
                    drawColor(Color.rgb(214, 226, 251))
                    drawCircle(280f, 195f, 142f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(45, 91, 167) })
                    drawRect(300f, 126f, 550f, 309f, Paint().apply { color = Color.rgb(255, 195, 79) })
                }
                requireNotNull(resolver.openOutputStream(inserted)).use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
            } finally { bitmap.recycle() }
            check(resolver.update(inserted, ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) }, null, null) == 1)
        } catch (error: Exception) { close(); throw error }
    }

    suspend fun expectedFingerprint(): String = importSessionPictures(resolver, listOf(requireNotNull(uri).toString()), 700_000).single().image.fingerprint

    fun selectInSystemPicker() {
        val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
        val originalFlags = automation.serviceInfo.flags
        automation.serviceInfo = automation.serviceInfo.apply {
            flags = flags or AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS or
                AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS or AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS
        }
        try {
            click("the only generated photo", tap = true) { node ->
                node.contentDescription?.toString()?.let { it.startsWith("Photo taken") || it.startsWith("照片拍摄") } == true
            }
            click("confirm one selection") { node ->
                listOf(node.text, node.contentDescription).any { value ->
                    value?.toString()?.trim()?.matches(Regex("(?:(?:Add|添加).*1.*|Done(?:,.*)?|完成)", RegexOption.IGNORE_CASE)) == true
                } ||
                    (node.viewIdResourceName?.endsWith("/button_add") == true && node.isEnabled)
            }
        } finally {
            automation.serviceInfo = automation.serviceInfo.apply { flags = originalFlags }
        }
    }

    private fun click(label: String, tap: Boolean = false, predicate: (AccessibilityNodeInfo) -> Boolean) {
        val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
        val until = SystemClock.uptimeMillis() + 20_000L
        var last = emptyList<String>()
        fun collect(node: AccessibilityNodeInfo): List<AccessibilityNodeInfo> = listOf(node) +
            (0 until node.childCount).flatMap { node.getChild(it)?.let(::collect).orEmpty() }
        while (SystemClock.uptimeMillis() < until) {
            val roots = automation.windows.mapNotNull { it.root }.ifEmpty { listOfNotNull(automation.rootInActiveWindow) }
            val nodes = roots.flatMap(::collect).filter { it.isVisibleToUser }
            last = nodes.mapNotNull { it.viewIdResourceName?.substringAfterLast('/') }.distinct().take(40)
            val candidates = nodes.filter(predicate)
            val match = candidates.distinctBy { node -> Rect().also(node::getBoundsInScreen) }.singleOrNull()
            val clickable = candidates.mapNotNull { candidate -> generateSequence(candidate) { it.parent }.firstOrNull { node ->
                node.isEnabled && (node.isClickable || node.actionList.any { it.id == AccessibilityNodeInfo.ACTION_CLICK })
            } }.distinctBy { node -> Rect().also(node::getBoundsInScreen) }.singleOrNull()
            if (tap && match != null) {
                val bounds = Rect().also(match::getBoundsInScreen)
                if (!bounds.isEmpty && matchesGeneratedThumbnail(bounds)) {
                    tapAt(automation, bounds.exactCenterX(), bounds.exactCenterY())
                    return
                }
            }
            if (!tap && clickable?.performAction(AccessibilityNodeInfo.ACTION_CLICK) == true) return
            if (!tap && clickable != null) {
                val bounds = Rect().also(clickable::getBoundsInScreen)
                if (!bounds.isEmpty) {
                    tapAt(automation, bounds.exactCenterX(), bounds.exactCenterY())
                    return
                }
            }
            if (label == "confirm one selection" && Build.VERSION.SDK_INT == 37 && confirmApi37Picker(automation)) return
            SystemClock.sleep(100)
        }
        error("System picker did not expose $label; control IDs: $last")
    }

    /** API 37's Compose picker omits the bottom Done bar from accessibility. Verify its pixels before one tap. */
    private fun confirmApi37Picker(automation: android.app.UiAutomation): Boolean {
        val bitmap = automation.takeScreenshot() ?: return false
        val width = bitmap.width
        val height = bitmap.height
        return try {
            fun blue(x: Double, y: Double): Boolean {
                val c = bitmap.getPixel((width * x).toInt(), (height * y).toInt())
                return Color.red(c) in 65..95 && Color.green(c) in 75..110 && Color.blue(c) in 120..155
            }
            if (!blue(.77, .916) || !blue(.92, .916) || !blue(.84, .901)) return false
            tapAt(automation, width * .84f, height * .916f)
            true
        } finally { bitmap.recycle() }
    }

    private fun tapAt(automation: android.app.UiAutomation, x: Float, y: Float) {
        val down = SystemClock.uptimeMillis()
        for (action in listOf(MotionEvent.ACTION_DOWN, MotionEvent.ACTION_UP)) {
            val event = MotionEvent.obtain(down, SystemClock.uptimeMillis(), action, x, y, 0)
            try { event.source = InputDevice.SOURCE_TOUCHSCREEN; check(automation.injectInputEvent(event, true)) }
            finally { event.recycle() }
        }
    }

    private fun matchesGeneratedThumbnail(rect: Rect): Boolean {
        val bitmap = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot() ?: return false
        return try {
            fun match(x: Double, y: Double, r: Int, g: Int, b: Int): Boolean {
                val px = rect.left + (rect.width() * x).toInt()
                val py = rect.top + (rect.height() * y).toInt()
                if (px !in 0 until bitmap.width || py !in 0 until bitmap.height) return false
                val color = bitmap.getPixel(px, py)
                return kotlin.math.abs(Color.red(color) - r) <= 38 && kotlin.math.abs(Color.green(color) - g) <= 38 &&
                    kotlin.math.abs(Color.blue(color) - b) <= 38
            }
            match(.12, .10, 214, 226, 251) && match(.25, .50, 45, 91, 167) && match(.75, .50, 255, 195, 79)
        } finally { bitmap.recycle() }
    }

    override fun close() {
        uri?.let { resolver.delete(it, null, null) }
        uri = null
    }
}
