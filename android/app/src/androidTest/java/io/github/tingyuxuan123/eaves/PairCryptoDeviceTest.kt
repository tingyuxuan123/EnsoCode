package io.github.tingyuxuan123.eaves

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import io.github.tingyuxuan123.eaves.pair.FrameCrypto
import io.github.tingyuxuan123.eaves.pair.FrameReplay
import io.github.tingyuxuan123.eaves.pair.PairBox
import io.github.tingyuxuan123.eaves.pair.PairCryptoException
import io.github.tingyuxuan123.eaves.pair.PairEncoding
import io.github.tingyuxuan123.eaves.pair.ReplayRole
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Check Android's JCE/provider/D8 runtime, not only the desktop JVM implementation. */
@RunWith(AndroidJUnit4::class)
class PairCryptoDeviceTest {
    @Test fun androidUnboxesTsVectorAndProducesHostReadableBox() {
        val fixture = InstrumentationRegistry.getInstrumentation().context.assets.open("crypto.json")
            .bufferedReader().use { Json.parseToJsonElement(it.readText()).jsonObject.getValue("box").jsonObject }
        fun bytes(name: String): ByteArray = PairEncoding.fromBase64Url(fixture.getValue(name).jsonPrimitive.content)
        val hostSecret = bytes("hostSecretKey")
        val contentKey = bytes("contentKey")
        val wire = fixture.getValue("boxedKey").jsonPrimitive.content
        assertArrayEquals(contentKey, PairBox.openBoxedContentKey(PairBox.decodeBoxedKey(wire), hostSecret))
        val randomBox = PairBox.boxContentKey(contentKey, bytes("hostPublicKey"))
        val received = PairBox.decodeBoxedKey(PairBox.encodeBoxedKey(randomBox))
        assertArrayEquals(contentKey, PairBox.openBoxedContentKey(received, hostSecret))
        received.boxed[0] = (received.boxed[0].toInt() xor 1).toByte()
        assertThrows(PairCryptoException::class.java) { PairBox.openBoxedContentKey(received, hostSecret) }
    }

    @Test fun androidReplayAuthenticatesDirectionsRejectsDuplicateAndRequiresFreshChallengeAfterReset() {
        val key = PairBox.generateContentKey()
        try {
            val host = FrameReplay(key, ReplayRole.Host, announce = true, requireModern = true)
            val guest = FrameReplay(key, ReplayRole.Guest, requireModern = true)
            val hello = JsonObject(mapOf("type" to JsonPrimitive("replay-hello")))
            val announcement = host.seal(hello)
            assertNull(host.open(announcement))
            assertFalse(guest.open(announcement)!!.trusted)
            assertTrue(host.open(guest.seal(hello))!!.trusted)
            assertTrue(guest.open(host.seal(hello))!!.trusted)
            val payload = JsonObject(mapOf("type" to JsonPrimitive("probe"), "id" to JsonPrimitive("android")))
            val packet = host.seal(payload)
            assertEquals(payload, guest.open(packet)!!.payload)
            assertNull(guest.open(packet))
            guest.peerReset()
            assertFalse(guest.isReady())
            assertFalse(guest.open(host.seal(payload))!!.trusted)
            host.open(guest.seal(hello))
            assertTrue(guest.open(host.seal(hello))!!.trusted)
            assertTrue(guest.isReady())
            assertTrue(FrameCrypto.open(key, packet) is JsonObject)
        } finally { key.fill(0) }
    }
}
