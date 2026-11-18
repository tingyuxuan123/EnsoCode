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

/** Draft text at rest: Keystore round trip, pairing isolation, corrupt file recovery. */
@RunWith(AndroidJUnit4::class)
class TextDraftDeviceTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val file get() = File(context.noBackupFilesDir, "text_drafts.bin")
    private var backup: ByteArray? = null

    @Before fun stashExistingDrafts() {
        backup = if (file.exists()) file.readBytes() else null
        file.delete()
    }

    @After fun restoreExistingDrafts() {
        file.delete()
        backup?.let { file.writeBytes(it) }
    }

    private val code = DraftKey(DraftKind.Session, "session-1")
    private val chat = DraftKey(DraftKind.Chat, "chat-1")

    @Test fun draftsSurviveANewStoreInstanceWithoutPlaintextOnDisk() {
        val entries = mapOf(code to "写了一半的代码任务", chat to "群里未发出的文字")
        AndroidTextDraftStore(context).save("pair-a", entries)
        assertEquals(entries, AndroidTextDraftStore(context).load("pair-a"))
        val raw = file.readBytes()
        assertTrue(file.length() > 0)
        for (text in entries.values) assertFalse(String(raw, Charsets.ISO_8859_1).contains(text))
    }

    @Test fun anotherPairingIdentityNeverReadsThePreviousDrafts() {
        AndroidTextDraftStore(context).save("pair-a", mapOf(code to "旧电脑草稿"))
        assertEquals(emptyMap<DraftKey, String>(), AndroidTextDraftStore(context).load("pair-b"))
        AndroidTextDraftStore(context).save("pair-b", mapOf(chat to "新电脑草稿"))
        assertEquals(emptyMap<DraftKey, String>(), AndroidTextDraftStore(context).load("pair-a"))
        assertEquals(mapOf(chat to "新电脑草稿"), AndroidTextDraftStore(context).load("pair-b"))
    }

    @Test fun corruptFileReadsAsEmptyAndTheNextSaveRecovers() {
        file.writeBytes(ByteArray(64) { (it * 7).toByte() })
        assertEquals(emptyMap<DraftKey, String>(), AndroidTextDraftStore(context).load("pair-a"))
        AndroidTextDraftStore(context).save("pair-a", mapOf(code to "重建的草稿"))
        assertEquals(mapOf(code to "重建的草稿"), AndroidTextDraftStore(context).load("pair-a"))
    }

    @Test fun clearOnlyRemovesTheMatchingIdentity() {
        AndroidTextDraftStore(context).save("pair-a", mapOf(code to "草稿"))
        AndroidTextDraftStore(context).clear("pair-b")
        assertEquals(mapOf(code to "草稿"), AndroidTextDraftStore(context).load("pair-a"))
        AndroidTextDraftStore(context).clear("pair-a")
        assertFalse(file.exists())
        AndroidTextDraftStore(context).save("pair-a", mapOf(code to "解绑后的新草稿"))
        assertEquals(mapOf(code to "解绑后的新草稿"), AndroidTextDraftStore(context).load("pair-a"))
    }
}
