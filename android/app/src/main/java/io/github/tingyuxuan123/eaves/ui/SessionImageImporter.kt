package io.github.tingyuxuan123.eaves.ui

import android.content.ContentResolver
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.util.Base64
import io.github.tingyuxuan123.eaves.mirror.SESSION_IMAGE_BYTES
import io.github.tingyuxuan123.eaves.mirror.SESSION_IMAGE_LIMIT
import io.github.tingyuxuan123.eaves.mirror.SessionImage
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext

internal data class LocalSessionPicture(val id: String, val image: SessionImage, val thumbnail: ByteArray, val jpegBytes: Int) {
    override fun toString(): String = "LocalSessionPicture(id=$id, jpegBytes=$jpegBytes)"
}

/** Only picker-granted content URIs; never file paths, URLs, filenames, original EXIF or original bytes on the wire. */
internal suspend fun importSessionPictures(resolver: ContentResolver, sources: List<String>, remainingBytes: Int): List<LocalSessionPicture> = withContext(Dispatchers.IO) {
    if (sources.size !in 1..SESSION_IMAGE_LIMIT || sources.distinct().size != sources.size) {
        throw PictureImportException("一次最多选择 4 张不同的图片。")
    }
    val budget = remainingBytes / sources.size
    sources.map { source ->
        currentCoroutineContext().ensureActive()
        val uri = Uri.parse(source)
        if (uri.scheme != ContentResolver.SCHEME_CONTENT) throw PictureImportException("只能读取系统选择器提供的图片。")
        val bytes = resolver.openInputStream(uri)?.use { readPictureBytes(it) }
            ?: throw PictureImportException("无法读取图片，请重新选择。")
        prepareSessionPicture(bytes, budget)
    }
}

internal suspend fun prepareSessionPicture(bytes: ByteArray, budget: Int): LocalSessionPicture {
    if (bytes.isEmpty() || bytes.size > PICTURE_INPUT_LIMIT || budget !in 1..SESSION_IMAGE_BYTES) {
        throw PictureImportException("图片大小不受支持。")
    }
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    if (bounds.outMimeType !in setOf("image/jpeg", "image/png")) {
        throw PictureImportException("本批支持 JPEG 和 PNG，请转换格式后重试。")
    }
    if (!validPictureDimensions(bounds.outWidth, bounds.outHeight)) throw PictureImportException("图片分辨率过高或内容无效，请先缩小。")
    val orientation = if (bounds.outMimeType == "image/jpeg") {
        ByteArrayInputStream(bytes).use { ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL) }
    } else ExifInterface.ORIENTATION_NORMAL
    val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply {
        inSampleSize = pictureSampleSize(bounds.outWidth, bounds.outHeight, PICTURE_EDGE)
        inPreferredConfig = Bitmap.Config.ARGB_8888
    }) ?: throw PictureImportException("图片损坏，未添加。")
    try {
        currentCoroutineContext().ensureActive()
        val matrix = Matrix().apply {
            when (orientation) {
                ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> setScale(-1f, 1f)
                ExifInterface.ORIENTATION_ROTATE_180 -> setRotate(180f)
                ExifInterface.ORIENTATION_FLIP_VERTICAL -> setScale(1f, -1f)
                ExifInterface.ORIENTATION_TRANSPOSE -> { setRotate(90f); postScale(-1f, 1f) }
                ExifInterface.ORIENTATION_ROTATE_90 -> setRotate(90f)
                ExifInterface.ORIENTATION_TRANSVERSE -> { setRotate(-90f); postScale(-1f, 1f) }
                ExifInterface.ORIENTATION_ROTATE_270 -> setRotate(-90f)
            }
        }
        val oriented = Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true)
        try {
            for (edge in listOf(PICTURE_EDGE, 1024, 800)) {
                currentCoroutineContext().ensureActive()
                val size = fitPicture(oriented.width, oriented.height, edge)
                val canvasBitmap = Bitmap.createBitmap(size.width, size.height, Bitmap.Config.ARGB_8888)
                try {
                    val canvas = Canvas(canvasBitmap)
                    canvas.drawColor(Color.WHITE)
                    canvas.drawBitmap(oriented, null, android.graphics.Rect(0, 0, size.width, size.height),
                        android.graphics.Paint(android.graphics.Paint.FILTER_BITMAP_FLAG))
                    for (quality in listOf(85, 70, 55, 40)) {
                        currentCoroutineContext().ensureActive()
                        val output = ByteArrayOutputStream()
                        if (!canvasBitmap.compress(Bitmap.CompressFormat.JPEG, quality, output)) throw PictureImportException("图片压缩失败，请重试。")
                        if (output.size() > budget) continue
                        val thumbSize = fitPicture(size.width, size.height, 192)
                        val thumb = Bitmap.createScaledBitmap(canvasBitmap, thumbSize.width, thumbSize.height, true)
                        val thumbnail = ByteArrayOutputStream()
                        try { thumb.compress(Bitmap.CompressFormat.JPEG, 70, thumbnail) }
                        finally { if (thumb !== canvasBitmap) thumb.recycle() }
                        val image = SessionImage(Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP))
                        // Precompute the echo identity off the main thread.
                        image.fingerprint
                        return LocalSessionPicture(UUID.randomUUID().toString(), image, thumbnail.toByteArray(), output.size())
                    }
                } finally { canvasBitmap.recycle() }
            }
        } finally { if (oriented !== decoded) oriented.recycle() }
        throw PictureImportException("无法把图片压缩到发送预算内，请换更小的图片或减少张数。")
    } finally { decoded.recycle() }
}
