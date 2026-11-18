package io.github.tingyuxuan123.eaves

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.media.ExifInterface
import android.util.Base64
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import io.github.tingyuxuan123.eaves.ui.PictureImportException
import io.github.tingyuxuan123.eaves.ui.prepareSessionPicture
import java.io.ByteArrayInputStream
import java.io.File
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ImageImportDeviceTest {
    @Test fun importRotatesJpegAndDropsLocationMetadata() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val source = File.createTempFile("attachment", ".jpg", context.cacheDir)
        try {
            val bitmap = Bitmap.createBitmap(1200, 2400, Bitmap.Config.ARGB_8888)
            try {
                bitmap.eraseColor(Color.rgb(57, 103, 175))
                source.outputStream().use { assertTrue(bitmap.compress(Bitmap.CompressFormat.JPEG, 85, it)) }
            } finally { bitmap.recycle() }
            val exif = ExifInterface(source.absolutePath)
            exif.setAttribute(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_ROTATE_90.toString())
            exif.setAttribute(ExifInterface.TAG_GPS_LATITUDE, "37/1,0/1,0/1")
            exif.setAttribute(ExifInterface.TAG_GPS_LATITUDE_REF, "N")
            exif.saveAttributes()
            val picture = prepareSessionPicture(source.readBytes(), 200_000)
            val data = Base64.decode(picture.image.data, Base64.DEFAULT)
            assertTrue(data.size <= 200_000)
            val output = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(data, 0, data.size, output)
            assertEquals(1600, output.outWidth)
            assertEquals(800, output.outHeight)
            val outputExif = ByteArrayInputStream(data).use(::ExifInterface)
            assertNull(outputExif.getAttribute(ExifInterface.TAG_GPS_LATITUDE))
            val preview = BitmapFactory.decodeByteArray(picture.thumbnail, 0, picture.thumbnail.size)
            try { assertEquals(192, preview.width) } finally { preview.recycle() }
        } finally { source.delete() }
    }

    @Test fun rejectsUnsupportedOrCorruptContent() = runBlocking {
        val result = runCatching { prepareSessionPicture("not an image".toByteArray(), 100_000) }
        assertTrue(result.exceptionOrNull() is PictureImportException)
    }
}
