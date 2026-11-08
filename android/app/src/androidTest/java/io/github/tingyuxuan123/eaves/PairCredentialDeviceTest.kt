package io.github.tingyuxuan123.eaves

import android.content.Context
import android.content.ContextWrapper
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import io.github.tingyuxuan123.eaves.mirror.AndroidPairCredentialStore
import io.github.tingyuxuan123.eaves.mirror.PairCredentials
import io.github.tingyuxuan123.eaves.mirror.PairException
import io.github.tingyuxuan123.eaves.mirror.PairFailure
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.nio.file.Files

@RunWith(AndroidJUnit4::class)
class PairCredentialDeviceTest {
    @Test fun androidKeystoreEncryptsAndPinsDurablyThenRejectsTampering() {
        val target = InstrumentationRegistry.getInstrumentation().targetContext
        val directory = Files.createTempDirectory(target.cacheDir.toPath(), "pair-store-test-").toFile()
        val context = object : ContextWrapper(target) {
            override fun getApplicationContext(): Context = this
            override fun getNoBackupFilesDir(): File = directory
        }
        val key = ByteArray(32) { 5 }
        val credential = PairCredentials("fixture-pair", "secret-fixture-token", key, "Test phone", "https://relay.example.test")
        val file = File(directory, "pair_credentials.bin")
        try {
            val store = AndroidPairCredentialStore(context)
            assertNull(store.load())
            store.save(credential)
            val encrypted = file.readBytes()
            assertFalse(encrypted.toString(Charsets.ISO_8859_1).contains("secret-fixture-token"))
            val restored = AndroidPairCredentialStore(context).load()!!
            assertArrayEquals(key, restored.contentKey)
            assertEquals("secret-fixture-token", restored.deviceToken)
            assertNull(restored.replayVersion)
            File(directory, "pair_credentials.bin.tmp").mkdir()
            assertEquals(PairFailure.STORAGE, assertThrows(PairException::class.java) { store.pin(credential) }.reason)
            assertNull(store.load()!!.replayVersion)
            store.pin(credential)
            store.save(credential) // Stale unpinned caller must not undo the durable pin.
            assertEquals(1, AndroidPairCredentialStore(context).load()!!.replayVersion)
            store.clear("another-pair")
            assertEquals("fixture-pair", store.load()!!.pairId)
            val corrupt = file.readBytes().also { it[it.lastIndex] = (it.last().toInt() xor 1).toByte() }
            file.writeBytes(corrupt)
            assertEquals(PairFailure.STORAGE, assertThrows(PairException::class.java) { store.load() }.reason)
            store.clear()
            assertNull(store.load())
        } finally { key.fill(0); directory.deleteRecursively() }
    }
}
