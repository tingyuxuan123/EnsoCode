package io.github.tingyuxuan123.eaves.mirror

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
import kotlinx.coroutines.CancellationException

class AndroidPairCredentialStore(
    context: Context,
    private val allowLoopbackHttp: Boolean = false,
) : PairCredentialStore {
    private val appContext = context.applicationContext ?: context
    private val directory: File get() = appContext.noBackupFilesDir
    private val record: File get() = File(directory, "pair_credentials.bin")
    private val staged: File get() = File(directory, "pair_credentials.bin.tmp")

    override fun load(): PairCredentials? = locked {
        read().also {
            // A previous rename whose directory sync failed must not be treated as durable.
            syncDirectory()
        }
    }

    override fun save(credentials: PairCredentials) = locked {
        val next = PairCredentialRecord.normalize(credentials, allowLoopbackHttp)
        write(PairCredentialRecord.preservePin(read(), next))
    }

    override fun pin(credentials: PairCredentials) = locked {
        val expected = PairCredentialRecord.normalize(credentials, allowLoopbackHttp)
        val current = read()
        val pinned = PairCredentialRecord.pin(current, expected)
        if (pinned === current) syncDirectory() else write(pinned)
    }

    override fun clear(expectedPairId: String?) = locked {
        if (expectedPairId == null || read()?.pairId == expectedPairId) {
            Files.deleteIfExists(staged.toPath())
            Files.deleteIfExists(record.toPath())
        }
        syncDirectory()
    }

    private fun read(): PairCredentials? {
        val source = try {
            Files.newInputStream(record.toPath())
        } catch (_: NoSuchFileException) {
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
            require(size in (1 + IV_SIZE + TAG_SIZE)..MAX_ENVELOPE_SIZE)
            buffer.copyOf(size)
        }
        require(envelope[0] == ENVELOPE_VERSION)
        val iv = envelope.copyOfRange(1, 1 + IV_SIZE)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, key(create = false), GCMParameterSpec(TAG_SIZE * 8, iv))
        cipher.updateAAD(AAD)
        val plaintext = cipher.doFinal(envelope, 1 + IV_SIZE, envelope.size - 1 - IV_SIZE)
        return try {
            PairCredentialRecord.decode(plaintext, allowLoopbackHttp)
        } finally {
            plaintext.fill(0)
        }
    }

    private fun write(credentials: PairCredentials) {
        val plaintext = PairCredentialRecord.encode(credentials)
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
        require(iv.size == IV_SIZE)
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
        check(create)
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

    private fun <T> locked(action: () -> T): T = synchronized(LOCK) {
        try {
            action()
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            throw PairException(PairFailure.STORAGE)
        }
    }

    private companion object {
        // The application uses a single process; serialize disk compare/update across store instances.
        val LOCK = Any()
        const val KEYSTORE = "AndroidKeyStore"
        const val KEY_ALIAS = "io.github.tingyuxuan123.eaves.pair.credentials.v1"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val ENVELOPE_VERSION: Byte = 1
        const val IV_SIZE = 12
        const val TAG_SIZE = 16
        const val MAX_ENVELOPE_SIZE = 1 + IV_SIZE + PairCredentialRecord.MAX_SIZE + TAG_SIZE
        val AAD = KEY_ALIAS.toByteArray(Charsets.UTF_8)
    }
}
