package io.github.tingyuxuan123.eaves.mirror

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

class PairCredentialRecordTest {
    @Test fun `record round trips the full identity and replay pin`() {
        for (version in listOf(null, 1)) {
            val input = credentials(version)
            val decoded = PairCredentialRecord.decode(PairCredentialRecord.encode(input), allowLoopbackHttp = false)
            assertEquals(input.pairId, decoded.pairId)
            assertEquals(input.deviceToken, decoded.deviceToken)
            assertArrayEquals(input.contentKey, decoded.contentKey)
            assertEquals(input.deviceName, decoded.deviceName)
            assertEquals(input.relayUrl, decoded.relayUrl)
            assertEquals(version, decoded.replayVersion)
        }
    }

    @Test fun `truncated or extended records never become legacy unpinned credentials`() {
        val encoded = PairCredentialRecord.encode(credentials(1))
        assertThrows(IllegalArgumentException::class.java) { PairCredentialRecord.decode(encoded.dropLast(1).toByteArray(), false) }
        assertThrows(IllegalArgumentException::class.java) { PairCredentialRecord.decode(encoded + 0.toByte(), false) }
    }

    @Test fun `replay pin applies only to same identity and same key`() {
        val unpinned = credentials(null)
        val pinned = PairCredentialRecord.pin(unpinned, credentials(null))
        assertEquals(1, pinned.replayVersion)
        assertEquals(1, PairCredentialRecord.preservePin(pinned, unpinned).replayVersion)
        val other = credentials(null, key = ByteArray(32) { 3 })
        assertThrows(IllegalArgumentException::class.java) { PairCredentialRecord.pin(pinned, other) }
        assertNull(PairCredentialRecord.preservePin(pinned, other).replayVersion)
    }

    @Test fun `secret bytes are owned by credentials and no fields are printed`() {
        val key = ByteArray(32) { 42 }
        val credentials = credentials(null, key)
        key.fill(0)
        credentials.contentKey.fill(1)
        assertArrayEquals(ByteArray(32) { 42 }, credentials.contentKey)
        for (secret in listOf(credentials.pairId, credentials.deviceToken, credentials.deviceName, credentials.relayUrl)) {
            assertFalse(credentials.toString().contains(secret))
        }
    }

    private fun credentials(version: Int?, key: ByteArray = ByteArray(32) { it.toByte() }) = PairCredentials(
        "private-pair-id", "private-device-token", key, "隐私设备", "https://private-relay.example/prefix", version
    )
}
