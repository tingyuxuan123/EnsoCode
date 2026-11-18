package io.github.tingyuxuan123.eaves.pair

import java.security.GeneralSecurityException
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import kotlinx.serialization.json.JsonElement

class PairCryptoException(message: String, cause: Throwable? = null) : IllegalArgumentException(message, cause)

/** AES primitive only: nonce allocation and replay authentication belong to the replay layer. */
object FrameCrypto {
    private const val VERSION: Byte = 1
    private const val NONCE_SIZE = 12
    private const val TAG_SIZE = 16
    private const val HEADER_SIZE = 1 + NONCE_SIZE

    internal fun sealWithNonce(key: ByteArray, payload: JsonElement, nonce: ByteArray): ByteArray {
        requireKey(key)
        if (nonce.size != NONCE_SIZE) throw PairCryptoException("Nonce must be 12 bytes")
        val plaintext = WireJson.stringify(payload).toByteArray(Charsets.UTF_8)
        return try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce))
            byteArrayOf(VERSION) + nonce + cipher.doFinal(plaintext)
        } catch (error: GeneralSecurityException) {
            throw PairCryptoException("Frame encryption failed", error)
        }
    }

    fun open(key: ByteArray, frame: ByteArray): JsonElement {
        requireKey(key)
        if (frame.size < HEADER_SIZE + TAG_SIZE) throw PairCryptoException("Frame too short")
        if (frame[0] != VERSION) throw PairCryptoException("Unsupported frame version")
        val plaintext = try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, frame.copyOfRange(1, HEADER_SIZE)))
            cipher.doFinal(frame, HEADER_SIZE, frame.size - HEADER_SIZE)
        } catch (error: GeneralSecurityException) {
            throw PairCryptoException("Frame authentication failed", error)
        }
        return WireJson.parse(plaintext.toString(Charsets.UTF_8))
    }

    private fun requireKey(key: ByteArray) {
        if (key.size != 32) throw PairCryptoException("Content key must be 32 bytes")
    }
}
