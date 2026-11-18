package io.github.tingyuxuan123.eaves.pair

import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class PrimitiveContractTest {
    @Test fun `base64url输出去掉填充且接受浏览器可读的标准字母和空白`() {
        assertEquals("-_8", PairEncoding.toBase64Url(byteArrayOf(251.toByte(), 255.toByte())))
        assertArrayEquals(byteArrayOf(251.toByte(), 255.toByte()), PairEncoding.fromBase64Url("+/8="))
        assertArrayEquals(byteArrayOf(251.toByte(), 255.toByte()), PairEncoding.fromBase64Url(" -_8=\t\r\n"))
        assertArrayEquals(byteArrayOf(), PairEncoding.fromBase64Url("\t\r\n\u000c"))
        assertArrayEquals(byteArrayOf(0), PairEncoding.fromBase64Url("AA="))
    }

    @Test fun `坏的base64字符和填充不能被静默忽略`() {
        for (value in listOf("a", "a===", "AA===", "A=AA", "AA!", "AA\u000b", "你好", "====", " \t\r\n\u000c")) {
            assertThrows("invalid base64: $value", IllegalArgumentException::class.java) { PairEncoding.fromBase64Url(value) }
        }
    }

    @Test fun `片段优先且重复参数取第一个而不是后一个`() {
        val key = Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(32) { it.toByte() })
        val invite = PairEncoding.parsePairUri(
            " https://EXAMPLE.com:443/p?pk=bad#relay=https%3A%2F%2Fone.test&relay=https%3A%2F%2Ftwo.test&pk=$key "
        )
        assertEquals("https://one.test", invite.relay)
        assertArrayEquals(ByteArray(32) { it.toByte() }, invite.publicKey)
    }

    @Test fun `缺relay回退到标准化origin不带路径或默认端口`() {
        val invite = PairEncoding.parsePairUri("https://EXAMPLE.com:443/path?pk=AQ")
        assertEquals("https://example.com", invite.relay)
        assertArrayEquals(byteArrayOf(1), invite.publicKey)
        assertEquals("http://127.0.0.1:8787", PairEncoding.parsePairUri("http://127.0.0.1:8787/#pk=AQ").relay)
        assertEquals("https://example.com", PairEncoding.parsePairUri("https://example.com\\@elsewhere.test/#pk=AQ").relay)
    }

    @Test fun `非空坏片段不能偷偷回退到查询串`() {
        assertThrows(IllegalArgumentException::class.java) { PairEncoding.parsePairUri("https://example.com/?pk=AQ#irrelevant") }
        assertThrows(IllegalArgumentException::class.java) { PairEncoding.parsePairUri("enso://pair?pk=AQ") }
        assertThrows(IllegalArgumentException::class.java) { PairEncoding.parsePairUri("file:///pair?relay=x&pk=AQ") }
        assertThrows(IllegalArgumentException::class.java) { PairEncoding.parsePairUri("enso://pair?relay=x\n&pk=AQ") }
        assertThrows(IllegalArgumentException::class.java) { PairEncoding.parsePairUri("https://example.com/??pk=AQ") }
    }

    @Test fun `参数按URLSearchParams规则处理加号百分号和空值`() {
        val invite = PairEncoding.parsePairUri("enso://pair?relay=https%3A%2F%2Fexample.com%2Fa+b&pk=AQ")
        assertEquals("https://example.com/a b", invite.relay)
        assertEquals("%ZZ", PairEncoding.parsePairUri("enso://pair?relay=%ZZ&pk=AQ").relay)
        assertThrows(IllegalArgumentException::class.java) { PairEncoding.parsePairUri("https://example.com/#relay=&pk=AQ") }
    }

    @Test fun `不合法的origin统一以参数错误拒绝`() {
        for (value in listOf("https://[broken/#pk=AQ", "https://x:wrong/#pk=AQ", "http://x:65536/#pk=AQ")) {
            assertThrows(IllegalArgumentException::class.java) { PairEncoding.parsePairUri(value) }
        }
    }

    private val key = ByteArray(32) { it.toByte() }
    private val nonce = ByteArray(12) { (it + 10).toByte() }
    private val payload = JsonObject(linkedMapOf("type" to JsonPrimitive("prompt"), "text" to JsonPrimitive("檐下 ☔")))

    @Test fun `AES帧是版本一后接原始nonce和JCE密文及tag`() {
        val frame = FrameCrypto.sealWithNonce(key, payload, nonce)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce))
        assertArrayEquals(byteArrayOf(1) + nonce + cipher.doFinal(payload.toString().toByteArray(Charsets.UTF_8)), frame)
        assertEquals(payload, FrameCrypto.open(key, frame))
    }

    @Test fun `密钥nonce版本短帧错误均拒绝且不返回空JSON`() {
        assertThrows(PairCryptoException::class.java) { FrameCrypto.sealWithNonce(ByteArray(16), payload, nonce) }
        assertThrows(PairCryptoException::class.java) { FrameCrypto.sealWithNonce(key, payload, ByteArray(11)) }
        assertThrows(PairCryptoException::class.java) { FrameCrypto.open(key, ByteArray(28)) }
        assertThrows(PairCryptoException::class.java) { FrameCrypto.open(key, ByteArray(29) { 9 }) }
    }

    @Test fun `坏密钥或tag篡改都不能通过认证`() {
        val frame = encryptRaw(payload.toString())
        assertThrows(PairCryptoException::class.java) { FrameCrypto.open(ByteArray(32) { 7 }, frame) }
        frame[frame.lastIndex] = (frame.last().toInt() xor 1).toByte()
        assertThrows(PairCryptoException::class.java) { FrameCrypto.open(key, frame) }
    }

    @Test fun `认证通过但不是JSON的明文仍须拒绝`() {
        for (text in listOf("", "not-json", "NaN", "01", "{\"x\":}", "[1,]", "true false",
            "\"a\u0001b\"", "{\"x\":\"a\nb\"}", "{unquoted:1}")) {
            assertThrows("not JSON: $text", PairCryptoException::class.java) { FrameCrypto.open(key, encryptRaw(text)) }
        }
        for (text in listOf("null", "true", "[1,\"中文\"]", "1.5e2", "{\"future-field\":1}")) {
            assertEquals(Json.parseToJsonElement(text), FrameCrypto.open(key, encryptRaw(text)))
        }
    }

    @Test fun `重复JSON键不能掩盖前一个坏值但合法重复键保留最后一个值`() {
        assertThrows(PairCryptoException::class.java) {
            FrameCrypto.open(key, encryptRaw("""{"x":not-json,"x":1}"""))
        }
        assertEquals(JsonObject(mapOf("x" to JsonPrimitive(2))),
            FrameCrypto.open(key, encryptRaw("""{"x":1,"x":2}""")))
    }

    @Test fun `嵌套上限拒绝过深帧且正常嵌套可解`() {
        val depth = 128
        var value = FrameCrypto.open(key, encryptRaw("[".repeat(depth) + "0" + "]".repeat(depth)))
        repeat(depth) { value = (value as JsonArray).single() }
        assertEquals(JsonPrimitive(0), value)
        assertThrows(PairCryptoException::class.java) {
            FrameCrypto.open(key, encryptRaw("[".repeat(10_000) + "0" + "]".repeat(10_000)))
        }
    }

    @Test fun `UTF8明文头部的BOM按TextDecoder规则移除一次`() {
        assertEquals(JsonPrimitive(true), FrameCrypto.open(key, encryptRaw("\uFEFFtrue")))
        assertThrows(PairCryptoException::class.java) { FrameCrypto.open(key, encryptRaw("\uFEFF\uFEFFtrue")) }
    }

    @Test fun `未配对的UTF16代理项按JSON字符串转义而不是变成问号`() {
        val value = JsonPrimitive("x\uD800y\uDC00z")
        assertEquals(value, FrameCrypto.open(key, FrameCrypto.sealWithNonce(key, value, nonce)))
    }

    @Test fun `坏帧错误栈不带可被日志打印的解密明文`() {
        val error = assertThrows(PairCryptoException::class.java) {
            FrameCrypto.open(key, encryptRaw("""{"data":"private-marker",}"""))
        }
        check("private-marker" !in error.stackTraceToString())
    }

    private fun encryptRaw(text: String): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce))
        return byteArrayOf(1) + nonce + cipher.doFinal(text.toByteArray(Charsets.UTF_8))
    }
}
