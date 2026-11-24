package io.github.tingyuxuan123.codekiln

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import io.github.tingyuxuan123.codekiln.mirror.AndroidTextDraftStore
import io.github.tingyuxuan123.codekiln.mirror.DraftKey
import io.github.tingyuxuan123.codekiln.mirror.DraftKind
import java.io.File
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class FirstBatchStorageAcceptanceTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val file get() = File(context.noBackupFilesDir, "text_drafts.bin")
    private var backup: ByteArray? = null
    private var stashed = false
    private val key = DraftKey(DraftKind.Session, "same-id")

    @Before fun guardAndStash() {
        check(!File(context.noBackupFilesDir, "pair_credentials.bin").exists()) { "Dedicated unpaired emulator required" }
        backup = if (file.exists()) file.readBytes() else null
        stashed = true
        file.delete()
    }

    @After fun restore() {
        if (!stashed) return
        file.delete()
        backup?.let { file.writeBytes(it) }
    }

    @Test fun keystoreStoresASCIIAndUTF8MarkersOnlyAsCiphertextAndSeparatesDomains() {
        val entries = mapOf(key to "SECRET_ASCII_DRAFT_1487 中文",
            DraftKey(DraftKind.NewTask, key.id) to "SECRET_TASK_DRAFT_1487")
        AndroidTextDraftStore(context).save("pair-a", entries)
        val raw = file.readBytes()
        for (text in entries.values) {
            val plain = text.toByteArray(Charsets.UTF_8)
            assertFalse("UTF8 plaintext must not appear in the envelope", raw.toList().windowed(plain.size).any { it == plain.toList() })
        }
        assertEquals(entries, AndroidTextDraftStore(context).load("pair-a"))
        assertEquals(emptyMap<DraftKey, String>(), AndroidTextDraftStore(context).load("pair-b"))
        assertTrue(file.canonicalPath.startsWith(context.noBackupFilesDir.canonicalPath + File.separator))
    }

    @Test fun maximumChineseDraftReallySurvivesANewKeystoreStoreInstance() {
        val text = "字".repeat(32_000)
        AndroidTextDraftStore(context).save("pair-a", mapOf(key to text))
        assertEquals(text, AndroidTextDraftStore(context).load("pair-a")[key])
    }
}
