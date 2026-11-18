package io.github.tingyuxuan123.eaves.pair

import java.io.File
import java.nio.ByteBuffer
import java.security.MessageDigest
import java.util.concurrent.Callable
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class FrameReplayTest {
    private val key = ByteArray(32) { it.toByte() }
    private val probe = JsonObject(mapOf("type" to JsonPrimitive("probe")))

    @Test fun `共享向量中每步的密文去重可信状态和持久化行为一致`() {
        val vectors = loadVectors()
        val contentKey = bytes(vectors.text("key"))
        val scenarios = vectors.getValue("sequences").jsonArray
        assertEquals(6, scenarios.size)
        for (scenario in scenarios.map { it.jsonObject }) {
            val local = scenario.getValue("local").jsonObject
            val role = if (local.text("role") == "host") ReplayRole.Host else ReplayRole.Guest
            val entropy = ArrayDeque(listOf(bytes(local.text("prefix")), bytes(local.text("challenge"))))
            var pins = 0
            val state = FrameReplay(
                contentKey, role, local.bool("announce"), local.bool("requireModern"),
                onModern = { pins++; if (local["pinFails"]?.jsonPrimitive?.boolean == true) error("pin failed") },
                randomBytes = { length ->
                    (if (length == 12) bytes(vectors.text("legacyNonce")) else entropy.removeFirst()).also {
                        assertEquals(length, it.size)
                    }
                },
            )
            fun status() = mapOf("ready" to JsonPrimitive(state.isReady()), "failed" to JsonPrimitive(state.isFailed()),
                "pins" to JsonPrimitive(pins))
            for ((index, element) in scenario.getValue("steps").jsonArray.withIndex()) {
                val step = element.jsonObject
                val op = step.text("op")
                val context = "${scenario.text("name")} step $index ($op)"
                val expected = step.getValue("expected").jsonObject
                val actual: Map<String, JsonElement> = when (op) {
                    "receive" -> {
                        var error = false
                        val opened = try { state.open(bytes(step.text("frame"))) } catch (_: PairCryptoException) { error = true; null }
                        mapOf("accepted" to JsonPrimitive(opened != null), "trusted" to JsonPrimitive(opened?.trusted == true),
                            "error" to JsonPrimitive(error)) + (opened?.let { mapOf("payload" to it.payload) } ?: emptyMap())
                    }
                    "seal" -> {
                        val result = runCatching { state.seal(step.getValue("payload")) }
                        if (expected.bool("error")) {
                            assertTrue(context, result.exceptionOrNull() is PairCryptoException)
                            mapOf("error" to JsonPrimitive(true))
                        } else mapOf("error" to JsonPrimitive(false),
                            "frame" to JsonPrimitive(PairEncoding.toBase64Url(result.getOrThrow())))
                    }
                    "reset" -> {
                        entropy.addLast(bytes(step.text("challenge")))
                        state.peerReset()
                        emptyMap()
                    }
                    "takeHello" -> mapOf("hello" to JsonPrimitive(state.takeHello()))
                    "prefixRange" -> {
                        val digest = MessageDigest.getInstance("SHA-256")
                        val first = step.getValue("first").jsonPrimitive.int
                        val count = step.getValue("count").jsonPrimitive.int
                        val outcomes = (first until first + count).map { prefixIndex ->
                            val nonce = ByteBuffer.allocate(12).putInt(0x70656572).putInt(prefixIndex)
                                .putInt(step.getValue("counter").jsonPrimitive.int).array()
                            val payload = JsonObject(step.getValue("payload").jsonObject + ("replay" to JsonObject(linkedMapOf(
                                "r" to JsonPrimitive(if (role == ReplayRole.Host) "g" else "h"),
                                "p" to JsonPrimitive(PairEncoding.toBase64Url(nonce.copyOf(8))),
                                "c" to JsonPrimitive(step.text("challenge")),
                            ))))
                            val frame = FrameCrypto.sealWithNonce(contentKey, payload, nonce)
                            digest.update(frame)
                            val opened = state.open(frame)
                            JsonObject(mapOf("index" to JsonPrimitive(prefixIndex), "accepted" to JsonPrimitive(opened != null),
                                "trusted" to JsonPrimitive(opened?.trusted == true)) + status())
                        }
                        mapOf("accepted" to JsonPrimitive(outcomes.count { it.bool("accepted") }),
                            "trusted" to JsonPrimitive(outcomes.count { it.bool("trusted") }),
                            "framesSha256" to JsonPrimitive(digest.digest().joinToString("") { "%02x".format(it) }),
                            "first" to outcomes.first(), "last" to outcomes.last())
                    }
                    else -> error("Unknown vector operation: $op")
                }
                assertEquals(context, expected, JsonObject(actual + status()))
            }
            assertTrue("unused entropy in ${scenario.text("name")}", entropy.isEmpty())
        }
    }

    @Test fun `计数耗尽和双向bootstrap白名单与TS一致`() {
        val vectors = loadVectors()
        for (entry in vectors.getValue("counterCases").jsonArray.map { it.jsonObject }) {
            val number = entry.getValue("value").jsonPrimitive.longOrNull
            if (number == null) assertTrue(entry.bool("error")) // fractional values are unrepresentable in the Long API
            else if (entry["error"] != null) assertThrows(PairCryptoException::class.java) { nextReplayCounter(number) }
            else assertEquals(entry.getValue("next").jsonPrimitive.content.toLong(), nextReplayCounter(number))
        }
        for (entry in vectors.getValue("bootstrap").jsonArray.map { it.jsonObject }) {
            val type = entry.text("type")
            assertEquals(type, entry.bool("command"), isReplayBootstrap(type))
            assertEquals(type, entry.bool("response"), isReplayBootstrapResponse(type))
        }
    }

    @Test fun `旧代际解密结果不能认领前缀或消耗接收窗口`() {
        val host = FrameReplay(key, ReplayRole.Host, announce = true)
        lateinit var guest: FrameReplay
        var stale = true
        var pins = 0
        guest = FrameReplay(key, ReplayRole.Guest, false, true, { pins++ }, entropy(), decrypt = { k, f ->
            FrameCrypto.open(k, f).also { if (stale) guest.peerReset() }
        })
        val encrypted = host.seal(probe)
        assertNull(guest.open(encrypted))
        assertEquals(0, pins)
        stale = false
        assertNull(guest.open(encrypted) { false })
        assertEquals(probe, guest.open(encrypted)?.payload)
        assertEquals(1, pins)
        assertNull(guest.open(encrypted))
    }

    @Test fun `重置中途完成的发送失败且已预留计数不会回绕`() {
        lateinit var replay: FrameReplay
        var reset = true
        replay = FrameReplay(key, ReplayRole.Guest, false, true, {}, entropy(), encrypt = { k, p, nonce ->
            FrameCrypto.sealWithNonce(k, p, nonce).also { if (reset) replay.peerReset() }
        })
        assertThrows(PairCryptoException::class.java) { replay.seal(probe) }
        reset = false
        assertEquals(2, ByteBuffer.wrap(replay.seal(probe), 9, 4).int)
    }

    @Test fun `多个并行加密在完成顺序乱掉时仍只使用唯一递增nonce`() {
        val entered = CountDownLatch(2)
        val executor = Executors.newFixedThreadPool(2)
        try {
            val replay = FrameReplay(key, ReplayRole.Guest, false, true, {}, entropy(), encrypt = { k, p, nonce ->
                entered.countDown()
                check(entered.await(3, TimeUnit.SECONDS)) { "Crypto must not hold the replay state lock" }
                FrameCrypto.sealWithNonce(k, p, nonce)
            })
            val futures = List(2) { executor.submit(Callable { replay.seal(probe) }) }
            val counters = futures.map {
                val frame = it.get(5, TimeUnit.SECONDS)
                assertTrue(frame.size >= 29)
                ByteBuffer.wrap(frame, 9, 4).int
            }.sorted()
            assertEquals(listOf(1, 2), counters)
        } finally { executor.shutdownNow() }
    }

    @Test fun `质询随机重复就失败关闭且不会回退`() {
        val replay = FrameReplay(key, ReplayRole.Guest, false, true, {}, { ByteArray(it) })
        replay.peerReset()
        assertTrue(replay.isFailed())
        assertFalse(replay.isReady())
        assertFalse(replay.takeHello())
        assertThrows(PairCryptoException::class.java) { replay.seal(probe) }
    }

    @Test fun `加密前拒绝非对象仍消耗预留计数且覆盖调用方伪造的stamp`() {
        val replay = FrameReplay(key, ReplayRole.Guest, requireModern = true)
        assertThrows(PairCryptoException::class.java) { replay.seal(JsonPrimitive("not an object")) }
        val frame = replay.seal(JsonObject(probe + ("replay" to JsonPrimitive("forged"))))
        assertEquals(2, ByteBuffer.wrap(frame, 9, 4).int)
        val stamp = (FrameCrypto.open(key, frame) as JsonObject).getValue("replay").jsonObject
        assertEquals("g", stamp.text("r"))
    }

    @Test fun `同一输入并发解密只提交一次且每次可信必须匹配当前质询`() {
        val host = FrameReplay(key, ReplayRole.Host, announce = true, requireModern = true)
        val guest = FrameReplay(key, ReplayRole.Guest, requireModern = true)
        guest.open(host.seal(probe))
        host.open(guest.seal(probe))
        assertTrue(guest.open(host.seal(probe))!!.trusted)
        val frame = host.seal(probe)
        val executor = Executors.newFixedThreadPool(2)
        try {
            val futures = List(2) { executor.submit(Callable { guest.open(frame) }) }
            assertEquals(1, futures.count { it.get(5, TimeUnit.SECONDS)?.trusted == true })
        } finally { executor.shutdownNow() }
        guest.peerReset()
        assertFalse(guest.isReady())
        assertFalse(guest.open(host.seal(probe))!!.trusted)
        host.open(guest.seal(probe))
        assertTrue(guest.open(host.seal(probe))!!.trusted)
    }

    @Test fun `随机熵错误和坏密钥不能构造可工作的防重放对象`() {
        assertThrows(PairCryptoException::class.java) { FrameReplay(ByteArray(31)) }
        assertThrows(PairCryptoException::class.java) {
            FrameReplay(key, ReplayRole.Guest, false, true, {}, { ByteArray(it - 1) })
        }
    }

    @Test fun `重置时随机源报错后不再接受回显旧质询的帧`() {
        val host = FrameReplay(key, ReplayRole.Host, announce = true, requireModern = true)
        val seeded = entropy()
        var draws = 0
        val guest = FrameReplay(key, ReplayRole.Guest, false, true, {}, { size ->
            if (++draws > 2) throw PairCryptoException("fixture entropy unavailable") else seeded(size)
        })
        guest.open(host.seal(probe))
        host.open(guest.seal(probe))
        assertTrue(guest.open(host.seal(probe))!!.trusted)
        assertThrows(PairCryptoException::class.java) { guest.peerReset() }
        assertFalse(guest.isReady())
        assertTrue(guest.isFailed())
        assertNull(guest.open(host.seal(probe)))
        assertThrows(PairCryptoException::class.java) { guest.seal(probe) }
    }

    private fun entropy(): (Int) -> ByteArray {
        var fill = 0
        return { length -> ByteArray(length) { (++fill).toByte() } }
    }

    private fun loadVectors(): JsonObject {
        val directory = System.getProperty("eaves.pair.vectors") ?: error("Missing Gradle vector directory")
        return Json.parseToJsonElement(File(directory, "replay.json").readText()).jsonObject.also {
            assertEquals(1, it.getValue("version").jsonPrimitive.int)
        }
    }
    private fun JsonObject.text(key: String): String = getValue(key).jsonPrimitive.content
    private fun JsonObject.bool(key: String): Boolean = getValue(key).jsonPrimitive.boolean
    private fun bytes(text: String): ByteArray = PairEncoding.fromBase64Url(text)
}
