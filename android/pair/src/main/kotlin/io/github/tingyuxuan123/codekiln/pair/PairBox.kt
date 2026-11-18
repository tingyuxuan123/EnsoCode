package io.github.tingyuxuan123.eaves.pair

import com.iwebpp.crypto.TweetNaclFast
import com.iwebpp.crypto.TweetNaclFast.Box
import java.security.SecureRandom

/** Wire data only. Neither the content key nor either secret key is retained here. */
class BoxedContentKey(val ephPublicKey: ByteArray, val nonce: ByteArray, val boxed: ByteArray)

/** NaCl box (X25519-XSalsa20-Poly1305), interoperable with packages/pair. */
object PairBox {
    private const val CONTENT_KEY_SIZE = 32
    private const val BOXED_SIZE = CONTENT_KEY_SIZE + Box.overheadLength
    private val random = SecureRandom()
    private val zeroSharedSecret = ByteArray(Box.sharedKeyLength)

    fun generateContentKey(): ByteArray = randomBytes(CONTENT_KEY_SIZE)

    fun boxContentKey(contentKey: ByteArray, recipientPublicKey: ByteArray): BoxedContentKey {
        val ephemeralSecretKey = randomBytes(Box.secretKeyLength)
        return try {
            boxContentKeyWithEntropy(contentKey, recipientPublicKey, ephemeralSecretKey, randomBytes(Box.nonceLength))
        } finally {
            ephemeralSecretKey.fill(0)
        }
    }

    /** Deterministic entry point for cross-language test vectors only. */
    internal fun boxContentKeyWithEntropy(
        contentKey: ByteArray,
        recipientPublicKey: ByteArray,
        ephemeralSecretKey: ByteArray,
        nonce: ByteArray
    ): BoxedContentKey {
        if (contentKey.size != CONTENT_KEY_SIZE || recipientPublicKey.size != Box.publicKeyLength ||
            ephemeralSecretKey.size != Box.secretKeyLength || nonce.size != Box.nonceLength
        ) throw PairCryptoException("Invalid box input length")

        val ephemeralPublicKey = ByteArray(Box.publicKeyLength)
        if (TweetNaclFast.crypto_scalarmult_base(ephemeralPublicKey, ephemeralSecretKey) != 0) {
            throw PairCryptoException("Box public key generation failed")
        }
        val boxNonce = nonce.copyOf()
        val boxed = withCheckedBox(recipientPublicKey, ephemeralSecretKey) {
            it.box(contentKey, boxNonce) ?: throw PairCryptoException("Box encryption failed")
        }
        return BoxedContentKey(ephemeralPublicKey, boxNonce, boxed)
    }

    fun encodeBoxedKey(value: BoxedContentKey): String {
        checkBoxedLengths(value)
        return listOf(value.ephPublicKey, value.nonce, value.boxed).joinToString(".", transform = PairEncoding::toBase64Url)
    }

    fun decodeBoxedKey(wire: String): BoxedContentKey {
        if (wire.length != encodedLength(Box.publicKeyLength) + encodedLength(Box.nonceLength) + encodedLength(BOXED_SIZE) + 2) {
            throw PairCryptoException("Malformed boxed key")
        }
        val parts = wire.split('.', limit = 4)
        if (parts.size != 3) throw PairCryptoException("Malformed boxed key")
        return BoxedContentKey(
            decodePart(parts[0], Box.publicKeyLength),
            decodePart(parts[1], Box.nonceLength),
            decodePart(parts[2], BOXED_SIZE)
        )
    }

    fun openBoxedContentKey(value: BoxedContentKey, recipientSecretKey: ByteArray): ByteArray {
        checkBoxedLengths(value)
        if (recipientSecretKey.size != Box.secretKeyLength) throw PairCryptoException("Invalid box secret key length")
        return withCheckedBox(value.ephPublicKey, recipientSecretKey) {
            it.open(value.boxed, value.nonce) ?: throw PairCryptoException("Box authentication failed")
        }
    }

    private fun randomBytes(size: Int): ByteArray = ByteArray(size).also(random::nextBytes)

    private fun checkBoxedLengths(value: BoxedContentKey) {
        if (value.ephPublicKey.size != Box.publicKeyLength || value.nonce.size != Box.nonceLength ||
            value.boxed.size != BOXED_SIZE
        ) throw PairCryptoException("Invalid boxed key length")
    }

    private fun encodedLength(size: Int): Int = (size * 4 + 2) / 3

    private fun decodePart(part: String, size: Int): ByteArray {
        if (part.length != encodedLength(size)) throw PairCryptoException("Malformed boxed key")
        val bytes = try {
            PairEncoding.fromBase64Url(part)
        } catch (_: IllegalArgumentException) {
            throw PairCryptoException("Malformed boxed key")
        }
        if (bytes.size != size || PairEncoding.toBase64Url(bytes) != part) {
            throw PairCryptoException("Malformed boxed key")
        }
        return bytes
    }

    private inline fun <T> withCheckedBox(
        peerPublicKey: ByteArray,
        ownSecretKey: ByteArray,
        action: (Box) -> T
    ): T {
        // Check and box with the same snapshot, even if the caller's array changes.
        val publicKey = peerPublicKey.copyOf()
        val shared = ByteArray(Box.sharedKeyLength)
        try {
            // TweetNaCl's box would pass a low-order key's all-zero X25519 result into HSalsa20.
            // Reject it before the KDF, including noncanonical encodings of low-order points.
            if (TweetNaclFast.crypto_scalarmult(shared, ownSecretKey, publicKey) != 0 ||
                TweetNaclFast.crypto_verify_32(shared, zeroSharedSecret) == 0
            ) throw PairCryptoException("Invalid box public key")
        } finally {
            shared.fill(0)
        }

        val box = Box(publicKey, ownSecretKey)
        try {
            return action(box)
        } finally {
            // In the pinned implementation before() returns this instance's cached box key.
            box.before().fill(0)
        }
    }
}
