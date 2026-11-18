package io.github.tingyuxuan123.eaves.pair

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class GoldenVectorsTest {
    private fun vectors(file: String): JsonObject {
        val directory = System.getProperty("eaves.pair.vectors") ?: error("Missing Gradle vector directory")
        return Json.parseToJsonElement(File(directory, "$file.json").readText(Charsets.UTF_8)).jsonObject.also {
            assertEquals("Unsupported $file vector format", 1, it.getValue("version").jsonPrimitive.int)
        }
    }

    private fun JsonObject.text(key: String) = getValue(key).jsonPrimitive.content

    @Test fun `逐字节匹配TS的base64url输出和接受的输入`() {
        val fixture = vectors("primitives")
        val cases = fixture.getValue("base64").jsonArray
        assertTrue(cases.isNotEmpty())
        for (entry in cases) {
            val item = entry.jsonObject
            val bytes = item.text("hex").chunked(2).map { it.toInt(16).toByte() }.toByteArray()
            val encoded = item.text("encoded")
            assertEquals(encoded, PairEncoding.toBase64Url(bytes))
            assertArrayEquals(bytes, PairEncoding.fromBase64Url(encoded))
            item["accepted"]?.jsonArray?.forEach { variant ->
                assertArrayEquals(variant.jsonPrimitive.content, bytes, PairEncoding.fromBase64Url(variant.jsonPrimitive.content))
            }
        }
        fixture.getValue("invalidBase64").jsonArray.forEach { input ->
            assertThrows(IllegalArgumentException::class.java) { PairEncoding.fromBase64Url(input.jsonPrimitive.content) }
        }
    }

    @Test fun `与TS配对链接共享relay解析和公钥字节`() {
        val fixture = vectors("primitives")
        val cases = fixture.getValue("invites").jsonArray
        assertTrue(cases.isNotEmpty())
        for (entry in cases) {
            val item = entry.jsonObject
            val uri = item.text("uri")
            val actual = PairEncoding.parsePairUri(uri)
            assertEquals(uri, item.text("relay"), actual.relay)
            assertEquals(uri, item.text("publicKey"), PairEncoding.toBase64Url(actual.publicKey))
        }
        fixture.getValue("invalidInvites").jsonArray.forEach { input ->
            assertThrows(IllegalArgumentException::class.java) { PairEncoding.parsePairUri(input.jsonPrimitive.content) }
        }
    }

    @Test fun `与WebCrypto共享AES密文且双向读取JSON`() {
        val cases = vectors("primitives").getValue("frames").jsonArray
        assertTrue(cases.isNotEmpty())
        for (entry in cases) {
            val item = entry.jsonObject
            val key = PairEncoding.fromBase64Url(item.text("key"))
            val nonce = PairEncoding.fromBase64Url(item.text("nonce"))
            val frame = PairEncoding.fromBase64Url(item.text("frame"))
            val expected = Json.parseToJsonElement(item.text("plaintext"))
            assertEquals(expected, FrameCrypto.open(key, frame))
            assertArrayEquals(frame, FrameCrypto.sealWithNonce(key, expected, nonce))
        }
    }

    @Test fun `同步信封接受与拒绝结果逐项匹配TS`() {
        val cases = vectors("session-sync").getValue("cases").jsonArray
        assertTrue(cases.isNotEmpty())
        for (entry in cases) {
            val item = entry.jsonObject
            val input = item.getValue("input")
            val expected = if (item.getValue("accepted").jsonPrimitive.boolean) input else null
            assertEquals(item.text("name"), expected, SessionSync.parse(input))
        }
    }
}
