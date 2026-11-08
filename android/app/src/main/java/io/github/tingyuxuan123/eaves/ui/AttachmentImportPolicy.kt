package io.github.tingyuxuan123.eaves.ui

import java.io.InputStream
import java.io.ByteArrayOutputStream

internal data class PictureSize(val width: Int, val height: Int)
internal class PictureImportException(val userMessage: String) : Exception("Image import failed")

internal const val PICTURE_EDGE = 1_600
internal const val PICTURE_INPUT_LIMIT = 24 * 1024 * 1024

internal fun fitPicture(width: Int, height: Int, edge: Int): PictureSize {
    require(width > 0 && height > 0 && edge > 0)
    val longest = maxOf(width, height)
    if (longest <= edge) return PictureSize(width, height)
    fun scaled(size: Int) = ((size.toLong() * edge + longest / 2) / longest).toInt().coerceAtLeast(1)
    return PictureSize(scaled(width), scaled(height))
}

internal fun validPictureDimensions(width: Int, height: Int): Boolean =
    width in 1..32_768 && height in 1..32_768 && width.toLong() * height <= 80_000_000L

internal fun pictureSampleSize(width: Int, height: Int, edge: Int): Int {
    require(validPictureDimensions(width, height) && edge > 0)
    return Integer.highestOneBit(maxOf(1, maxOf(width, height) / edge))
}

internal fun readPictureBytes(input: InputStream, limit: Int = PICTURE_INPUT_LIMIT): ByteArray {
    require(limit > 0)
    val output = ByteArrayOutputStream()
    val buffer = ByteArray(16_384)
    while (true) {
        val count = input.read(buffer, 0, minOf(buffer.size, limit - output.size() + 1))
        if (count < 0) break
        if (count == 0) throw PictureImportException("无法读取这张图片。")
        if (count > limit - output.size()) throw PictureImportException("原图过大，请选用小于 24 MB 的图片。")
        output.write(buffer, 0, count)
    }
    if (output.size() == 0) throw PictureImportException("这张图片为空，未添加。")
    return output.toByteArray()
}
