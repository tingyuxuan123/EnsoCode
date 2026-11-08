package io.github.tingyuxuan123.eaves.pair

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Test

class PairBoxTest {
    private val vectors = run {
        val directory = checkNotNull(System.getProperty("eaves.pair.vectors"))
        Json.parseToJsonElement(File(directory, "crypto.json").readText(Charsets.UTF_8)).jsonObject.also {
            assertEquals(1, it.getValue("version").jsonPrimitive.int)
        }
    }
    private val box = vectors.getValue("box").jsonObject

    private fun JsonObject.text(key: String) = getValue(key).jsonPrimitive.content
    private fun bytes(key: String) = PairEncoding.fromBase64Url(box.text(key))
    private fun boxed() = PairBox.decodeBoxedKey(box.text("boxedKey"))
    private fun ByteArray.flipped(index: Int = 0) = copyOf().also { it[index] = (it[index].toInt() xor 1).toByte() }

    @Test fun `读取TS生成的盒子并恢复内容密钥`() {
        val value = boxed()
        assertArrayEquals(bytes("ephPublicKey"), value.ephPublicKey)
        assertArrayEquals(bytes("nonce"), value.nonce)
        assertArrayEquals(bytes("boxed"), value.boxed)
        assertArrayEquals(bytes("contentKey"), PairBox.openBoxedContentKey(value, bytes("hostSecretKey")))
    }

    @Test fun `固定输入生成与TS相同的盒子线格式`() {
        val value = PairBox.boxContentKeyWithEntropy(
            bytes("contentKey"), bytes("hostPublicKey"), bytes("ephSecretKey"), bytes("nonce")
        )
        assertEquals(box.text("boxedKey"), PairBox.encodeBoxedKey(value))
    }

    @Test fun `随机生成独立的内容密钥和一次性发送方密钥及nonce`() {
        val key = PairBox.generateContentKey()
        val next = PairBox.generateContentKey()
        assertEquals(32, key.size)
        assertEquals(32, next.size)
        assertFalse(key.contentEquals(next))
        val first = PairBox.boxContentKey(key, bytes("hostPublicKey"))
        val second = PairBox.boxContentKey(key, bytes("hostPublicKey"))
        assertFalse(first.ephPublicKey.contentEquals(second.ephPublicKey))
        assertFalse(first.nonce.contentEquals(second.nonce))
        val decoded = PairBox.decodeBoxedKey(PairBox.encodeBoxedKey(first))
        assertArrayEquals(key, PairBox.openBoxedContentKey(decoded, bytes("hostSecretKey")))
    }

    @Test fun `拒绝畸形与错误字节长度的盒子线格式`() {
        val valid = box.text("boxedKey")
        val publicKey = box.text("ephPublicKey")
        val nonce = box.text("nonce")
        val ciphertext = box.text("boxed")
        val invalid = vectors.getValue("invalidBoxedKeys").jsonArray.map { it.jsonPrimitive.content } + listOf(
            ".$nonce.$ciphertext",
            "$publicKey..$ciphertext",
            "$publicKey.$nonce.",
            "$publicKey=.$nonce.$ciphertext",
            "${publicKey.dropLast(1)}J.$nonce.$ciphertext", // Noncanonical trailing base64 bits.
            " $valid",
            "$valid.",
            "${PairEncoding.toBase64Url(ByteArray(31))}.$nonce.$ciphertext",
            "$publicKey.${PairEncoding.toBase64Url(ByteArray(25))}.$ciphertext",
            "$publicKey.$nonce.${PairEncoding.toBase64Url(ByteArray(47))}",
            "$publicKey.$nonce.${PairEncoding.toBase64Url(ByteArray(49))}"
        )
        for (wire in invalid) assertThrows(PairCryptoException::class.java) { PairBox.decodeBoxedKey(wire) }
    }

    @Test fun `直接传入错误长度也不能绕过盒子校验`() {
        val value = boxed()
        val key = bytes("contentKey")
        val recipient = bytes("hostPublicKey")
        assertThrows(PairCryptoException::class.java) { PairBox.boxContentKey(key.copyOf(31), recipient) }
        assertThrows(PairCryptoException::class.java) { PairBox.boxContentKey(key, recipient.copyOf(33)) }
        assertThrows(PairCryptoException::class.java) { PairBox.openBoxedContentKey(value, ByteArray(31)) }
        val invalid = listOf(
            BoxedContentKey(value.ephPublicKey.copyOf(33), value.nonce, value.boxed),
            BoxedContentKey(value.ephPublicKey, value.nonce.copyOf(23), value.boxed),
            BoxedContentKey(value.ephPublicKey, value.nonce, value.boxed.copyOf(49))
        )
        for (bad in invalid) {
            assertThrows(PairCryptoException::class.java) { PairBox.encodeBoxedKey(bad) }
            assertThrows(PairCryptoException::class.java) { PairBox.openBoxedContentKey(bad, bytes("hostSecretKey")) }
        }
    }

    @Test fun `篡改标签密文nonce公钥或用错私钥均不能解盒`() {
        val value = boxed()
        val secret = bytes("hostSecretKey")
        val invalid = listOf(
            BoxedContentKey(value.ephPublicKey, value.nonce, value.boxed.flipped()),
            BoxedContentKey(value.ephPublicKey, value.nonce, value.boxed.flipped(value.boxed.lastIndex)),
            BoxedContentKey(value.ephPublicKey, value.nonce.flipped(), value.boxed),
            BoxedContentKey(value.ephPublicKey.flipped(), value.nonce, value.boxed)
        )
        for (bad in invalid) {
            assertThrows(PairCryptoException::class.java) { PairBox.openBoxedContentKey(bad, secret) }
        }
        assertThrows(PairCryptoException::class.java) { PairBox.openBoxedContentKey(value, bytes("ephSecretKey")) }
    }

    @Test fun `发送和接收均拒绝产生全零共享密钥的小阶点`() {
        // TweetNaCl JS accepts a zero DH result; this ciphertext authenticates with that shared result.
        val forged = PairEncoding.fromBase64Url("xxopvLtkgj5cG5F734nxUZZ6Q5z3J2f0qyd-xct8hshWkEv_3WaVjVFLtJxAP1-I")
        val lowOrder = listOf(
            ByteArray(32),
            ByteArray(32).also { it[0] = 1 },
            ByteArray(32).also { it[31] = 0x80.toByte() }, // RFC 7748 masks the high bit.
            ByteArray(32) { 0xff.toByte() }.also { it[0] = 0xed.toByte(); it[31] = 0x7f } // p, i.e. zero mod p.
        )
        for (point in lowOrder) {
            assertThrows(PairCryptoException::class.java) { PairBox.boxContentKey(bytes("contentKey"), point) }
            assertThrows(PairCryptoException::class.java) {
                PairBox.openBoxedContentKey(BoxedContentKey(point, bytes("nonce"), forged), bytes("hostSecretKey"))
            }
        }
    }
}
