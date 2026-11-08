package io.github.tingyuxuan123.eaves

import android.net.Uri
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import io.github.tingyuxuan123.eaves.ui.importSessionPictures
import kotlinx.coroutines.runBlocking
import java.util.concurrent.atomic.AtomicReference
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PhotoPickerDeviceTest {
    @get:Rule val compose = createComposeRule()

    @Test fun systemPickerReturnsOnlyGrantedFixtureAndImporterCanReadIt() = runBlocking {
        assumeTrue(Build.VERSION.SDK_INT >= 33 && InstrumentationRegistry.getArguments().getString("eavesPhotoPicker") == "1")
        val resolver = InstrumentationRegistry.getInstrumentation().targetContext.contentResolver
        val selected = AtomicReference(emptyList<Uri>())
        compose.setContent {
            val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(4)) { selected.set(it) }
            TextButton(onClick = { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }) { Text("选择测试图片") }
        }
        PickerFixture(resolver).use { fixture ->
            compose.onNodeWithText("选择测试图片").performClick()
            fixture.selectInSystemPicker()
            compose.waitUntil(15_000) { selected.get().isNotEmpty() }
            assertEquals(1, selected.get().size)
            val imported = importSessionPictures(resolver, selected.get().map { it.toString() }, 700_000)
            assertEquals("image/jpeg", imported.single().image.mimeType)
            assertEquals(fixture.expectedFingerprint(), imported.single().image.fingerprint)
            assertTrue(imported.single().jpegBytes in 1..700_000)
        }
    }
}
