package io.github.tingyuxuan123.codekiln.mirror

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.system.Os
import android.system.OsConstants
import java.io.File
import java.io.FileOutputStream
import java.nio.file.Files
import java.nio.file.NoSuchFileException
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Draft text at rest: AES-GCM under a Keystore key, in the no-backup directory of this app.
 * Reading is fail-closed: an unreadable or foreign file reads as "no drafts" and is replaced on the next save.
 */
class AndroidTextDraftStore(context: Context) : TextDraftStore {
    private val appContext = context.applicationContext ?: context
    private val directory: File get() = appContext.noBackupFilesDir
    private val record: File get() = File(directory, "text_drafts.bin")
    private val staged: File get() = File(directory, "text_drafts.bin.tmp")

    override fun load(pairId: String): Map<DraftKey, String> = locked {
        TextDraftRecord.adopt(read(), pairId)
    }

    override fun save(pairId: String, entries: Map<DraftKey, String>) = locked {
        val normalized = TextDraftRecord.normalize(entries)
        if (normalized.isEmpty()) remove() else write(TextDraftRecord.Record(pairId, normalized))
    }

    override fun clear(pairId: String?) = locked {
        if (pairId == null || read()?.pairId == pairId) remove()
    }

    private fun read(): TextDraftRecord.Record? {
        val source = try {
            Files.newInputStream(record.toPath())
        } catch (_: NoSuchFileException) {
            return null
        } catch (_: Exception) {
            return null
        }
        val envelope = source.use { input ->
            val buffer = ByteArray(MAX_ENVELOPE_SIZE + 1)
            var size = 0
            while (size < buffer.size) {
                val count = input.read(buffer, size, buffer.size - size)
                if (count < 0) break
                size += count
            }
            if (size !in (1 + IV_SIZE + TAG_SIZE)..MAX_ENVELOPE_SIZE) null else buffer.copyOf(size)
        } ?: return null
        return try {
            if (envelope[0] != ENVELOPE_VERSION) return null
            val iv = envelope.copyOfRange(1, 1 + IV_SIZE)
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, key(create = false), GCMParameterSpec(TAG_SIZE * 8, iv))
            cipher.updateAAD(AAD)
            val plaintext = cipher.doFinal(envelope, 1 + IV_SIZE, envelope.size - 1 - IV_SIZE)
            try {
                TextDraftRecord.decode(plaintext)
            } finally {
                plaintext.fill(0)
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun write(value: TextDraftRecord.Record) {
        val plaintext = TextDraftRecord.encode(value.pairId, value.entries)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        val ciphertext = try {
            // AndroidKeyStore supplies a fresh, unpredictable IV and rejects caller-chosen IVs.
            cipher.init(Cipher.ENCRYPT_MODE, key(create = true))
            cipher.updateAAD(AAD)
            cipher.doFinal(plaintext)
        } finally {
            plaintext.fill(0)
        }
        val iv = cipher.iv
        check(iv.size == IV_SIZE)
        try {
            FileOutputStream(staged).use { out ->
                out.write(ENVELOPE_VERSION.toInt())
                out.write(iv)
                out.write(ciphertext)
                out.fd.sync()
            }
            Os.rename(staged.absolutePath, record.absolutePath)
        } finally {
            Files.deleteIfExists(staged.toPath())
        }
        syncDirectory()
    }

    private fun remove() {
        Files.deleteIfExists(staged.toPath())
        Files.deleteIfExists(record.toPath())
        syncDirectory()
    }

    private fun syncDirectory() {
        val fd = Os.open(directory.absolutePath, OsConstants.O_RDONLY, 0)
        try {
            check(OsConstants.S_ISDIR(Os.fstat(fd).st_mode))
            Os.fsync(fd)
        } finally {
            Os.close(fd)
        }
    }

    private fun key(create: Boolean): SecretKey {
        val store = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        val existing = store.getKey(KEY_ALIAS, null)
        if (existing != null) return existing as SecretKey
        check(create) { "Draft key missing" }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE).run {
            init(KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setKeySize(256)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build())
            generateKey()
        }
    }

    private fun <T> locked(action: () -> T): T = synchronized(LOCK) { action() }

    private companion object {
        // One process, one store: serialize read/modify/write across instances.
        val LOCK = Any()
        const val KEYSTORE = "AndroidKeyStore"
        const val KEY_ALIAS = "io.github.tingyuxuan123.codekiln.text.drafts.v1"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val ENVELOPE_VERSION: Byte = 1
        const val IV_SIZE = 12
        const val TAG_SIZE = 16
        const val MAX_ENVELOPE_SIZE = 1 + IV_SIZE + TextDraftRecord.MAX_SIZE + TAG_SIZE
        val AAD = KEY_ALIAS.toByteArray(Charsets.UTF_8)
    }
}
