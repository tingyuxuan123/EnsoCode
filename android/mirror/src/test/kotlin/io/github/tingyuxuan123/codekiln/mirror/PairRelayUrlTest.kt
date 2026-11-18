package io.github.tingyuxuan123.eaves.mirror

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class PairRelayUrlTest {
    @Test fun `HTTPS relay may have a reverse proxy prefix`() {
        val relay = PairRelayUrl.parse("https://Relay.Example:443/team/pairing/")
        assertEquals("https://relay.example/team/pairing", relay.toString())
        assertFalse(PairRelayUrl.isLoopback(relay))
    }

    @Test fun `cleartext requires the debug flag and literal IPv4 loopback`() {
        val loopback = "http://127.0.0.1:8765"
        assertThrows(IllegalArgumentException::class.java) { PairRelayUrl.parse(loopback) }
        assertTrue(PairRelayUrl.isLoopback(PairRelayUrl.parse(loopback, allowLoopbackHttp = true)))
        for (url in listOf("http://localhost", "http://127.1", "http://127.0.0.2", "http://127.000.0.1",
            "http://[::1]", "http://[::ffff:127.0.0.1]", "http://%31%32%37.0.0.1", "http://127.0.0.1.")) {
            assertThrows(url, IllegalArgumentException::class.java) { PairRelayUrl.parse(url, true) }
        }
    }

    @Test fun `missing authority and ambiguous components are rejected not repaired`() {
        for (url in listOf("https:relay.example", "https:///relay.example", "https://relay.example:",
            "https://@relay.example", "https://secret@relay.example", "https://relay.example?", "https://relay.example#",
            " https://relay.example", "https://re\tlay.example", "https://relay.example\\other.example",
            "https://2130706433", "https://relay.example/team/../base", "https://relay.example/team/%2E./base",
            "https://relay.example/team%2Fbase", "https://relay.example/team//base")) {
            assertThrows(url, IllegalArgumentException::class.java) { PairRelayUrl.parse(url) }
        }
    }
}
