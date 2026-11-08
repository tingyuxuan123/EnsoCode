package io.github.tingyuxuan123.eaves.pair

import java.net.URI
import java.net.URLEncoder
import java.nio.file.Files
import java.nio.file.Path
import java.security.SecureRandom
import java.util.concurrent.TimeUnit
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test

/** Explicitly opt-in: a real Go relay and the repository's TS fake host, never a user profile/model. */
class KotlinGuestInteropTest {
    @Test(timeout = 240_000)
    fun `Kotlin访客经真实Go中继完成配对认证流式同步审批提问和撤销`() {
        assumeTrue("Set EAVES_KOTLIN_PAIR_GO=1 to run the loopback smoke", System.getenv("EAVES_KOTLIN_PAIR_GO") == "1")
        val workspace = System.getProperty("eaves.pair.workspace")?.let(Path::of)
            ?: throw AssertionError("eaves.pair.workspace must identify the repository")
        assertTrue("Workspace must be absolute", workspace.isAbsolute)
        assertTrue("Go relay source must exist", Files.isRegularFile(workspace.resolve("packages/relay-go/go.mod")))
        assertTrue("Repository fake host must exist", Files.isRegularFile(workspace.resolve("scripts/pair-fake-host.mjs")))

        val directory = Files.createTempDirectory("eaves-kotlin-pair-")
        var cleanupKey: ByteArray? = null
        try {
            val contentKey = PairBox.generateContentKey().also { cleanupKey = it }
            val windows = System.getProperty("os.name").startsWith("Windows", ignoreCase = true)
            val executable = directory.resolve(if (windows) "relay.exe" else "relay")
            InteropProcess.start("Go build", workspace.resolve("packages/relay-go"),
                "go", "build", "-o", executable.toString(), ".").use { build ->
                assertEquals("Go relay build failed (output intentionally withheld)", 0, build.awaitExit(180))
            }
            InteropProcess.start("Go relay", directory, executable.toString(), "-listen", "127.0.0.1:0",
                "-db", directory.resolve("relay.sqlite").toString(), "-auto-update=false").use { relay ->
                val relayUrl = relay.waitFor(Regex("(http://127\\.0\\.0\\.1:[0-9]{1,5})\\r?\\n"), 1)
                // Parse only the bound loopback origin; never use a banner's LAN address.
                assertTrue("Relay must bind loopback", URI.create(relayUrl).host == "127.0.0.1")
                InteropProcess.start("Node fake host", workspace, "node", workspace.resolve("scripts/pair-fake-host.mjs").toString(),
                    "--relay", relayUrl).use { host ->
                    val link = host.waitFor(Regex("(?m)^Pair link: (\\S+)\\r?\\n"), 1)
                    val invite = PairEncoding.parsePairUri(link)
                    assertTrue("Invite must retain the disposable relay", invite.relay == relayUrl)
                    val boxedKey = PairBox.encodeBoxedKey(PairBox.boxContentKey(contentKey, invite.publicKey))
                    InteropHttp().use { http ->
                        val claim = http.claim(relayUrl, interopObject(
                            "publicKey" to JsonPrimitive(PairEncoding.toBase64Url(invite.publicKey)),
                            "boxedKey" to JsonPrimitive(boxedKey),
                            "deviceName" to JsonPrimitive("Kotlin loopback fixture"),
                        ))
                        assertTrue("Claim must authorize the pairing", claim.text("state") == "authorized")
                        val pairId = encode(claim.text("pairId"))
                        val token = claim.text("deviceToken")
                        assertTrue("Claim must return a device token", token.isNotEmpty())
                        val endpoint = URI.create("${relayUrl.replaceFirst("http://", "ws://")}/v1/pair/$pairId?role=guest&token=${encode(token)}")
                        // This callback only simulates successful durable pinning. No real settings are read/written.
                        var simulatedPinCount = 0
                        val replay = FrameReplay(contentKey, role = ReplayRole.Guest, requireModern = true,
                            onModern = { simulatedPinCount++ })
                        InteropSocket(http.client, endpoint).use { socket ->
                            val guest = InteropGuest(socket, replay)
                            guest.awaitControl("host-online")
                            socket.ping()
                            guest.awaitControl("pong")
                            val catalog = guest.take("initial catalog") { it.payload.text("type") == "catalog" }
                            val sessionId = catalog.array("entries").firstObject().text("id")

                            // Like the authoritative TS smoke, inject a fresh, unchallenged prefix,
                            // an unstamped legacy action, and garbage. None may change the fixture.
                            val action = interopObject("type" to JsonPrimitive("prompt"),
                                "sessionId" to JsonPrimitive(sessionId), "text" to JsonPrimitive("untrusted action"))
                            socket.send(FrameReplay(contentKey, role = ReplayRole.Guest, requireModern = true).seal(action))
                            val nonce = ByteArray(12).also { SecureRandom().nextBytes(it) }
                            socket.send(FrameCrypto.sealWithNonce(contentKey, JsonObject(action +
                                ("text" to JsonPrimitive("legacy action"))), nonce))
                            socket.send(ByteArray(42))
                            guest.awaitReady()
                            assertFalse("Modern replay must not fail", replay.isFailed())
                            assertEquals("Modern observation must simulate exactly one successful pin", 1, simulatedPinCount)
                            guest.send(interopObject("type" to JsonPrimitive("replay-hello")))
                            exerciseFixture(guest, sessionId)

                            http.revoke(URI.create("$relayUrl/v1/pair/$pairId?token=${encode(token)}"))
                            guest.awaitControl("revoked")
                            assertEquals("Revoke must close guest", 1008, guest.awaitClosed())
                            assertEquals("Revoke must stop fake host cleanly", 0, host.awaitExit(10))
                        }
                        // The same credential must no longer authorize a fresh socket.
                        InteropSocket(http.client, endpoint).use { denied ->
                            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
                            val message = denied.receive(deadline, "revoked credential rejection")
                            assertTrue("Revoked guest must be rejected", message is InteropMessage.Closed && message.code == 1008)
                        }
                        for (secret in listOf(token, PairEncoding.toBase64Url(contentKey), boxedKey)) {
                            assertFalse("Fake host output must not contain credentials", host.contains(secret))
                            assertFalse("Relay output must not contain credentials", relay.contains(secret))
                        }
                    }
                }
            }
        } finally {
            cleanupKey?.fill(0)
            interopDeleteDirectory(directory)
        }
    }

    private fun exerciseFixture(guest: InteropGuest, sessionId: String) {
        fun send(type: String, vararg fields: Pair<String, JsonElement>) {
            guest.send(interopObject("type" to JsonPrimitive(type), "sessionId" to JsonPrimitive(sessionId), *fields))
        }
        fun sync(requestId: String): JsonObject {
            val payload = guest.take("session sync") {
                it.trusted && it.payload.text("type") == "session-sync" && it.payload.text("requestId") == requestId
            }
            return SessionSync.parse(payload) ?: throw AssertionError("Kotlin rejected real session-sync envelope")
        }
        fun live(type: String): JsonObject = guest.take(type) {
            it.trusted && it.payload.text("type") == "agent-event" &&
                it.payload.obj("event").text("sessionId") == sessionId && it.payload.obj("event").text("type") == type
        }
        fun pending(field: String) {
            guest.take("pending request catalog") {
                it.trusted && it.payload.text("type") == "catalog" && it.payload.array("entries").firstObject().number(field) == 1L
            }
        }

        send("subscribe", "sync" to interopObject("requestId" to JsonPrimitive("kotlin-snapshot")))
        val initial = sync("kotlin-snapshot")
        assertEquals("snapshot", initial.text("mode"))
        val snapshot = initial.obj("snapshot")
        assertTrue("Snapshot must have real fixture history", snapshot.array("sessions").firstObject().array("messages").isNotEmpty())
        assertFalse("Untrusted writes must not enter history", snapshot.toString().contains("untrusted action"))
        assertFalse("Legacy writes must not enter history", snapshot.toString().contains("legacy action"))
        val cursor = initial.obj("cursor")
        assertTrue("Snapshot cursor must pass Kotlin validation", SessionSync.isCursor(cursor))

        val user = live("message-upsert").obj("event")
        val streaming = live("message-upsert")
        val final = live("message-upsert").obj("event")
        assertEquals("user", user.obj("message").text("role"))
        assertEquals("assistant", streaming.obj("event").obj("message").text("role"))
        assertEquals("Streaming must update the same index", streaming.obj("event").number("index"), final.number("index"))
        assertTrue("Streaming text must really change", streaming.obj("event").obj("message").array("content").firstObject().text("text") !=
            final.obj("message").array("content").firstObject().text("text"))
        assertTrue("Live event cursor must advance", streaming.obj("cursor").number("seq") > cursor.number("seq"))

        val approval = live("approval-request").obj("event").obj("request")
        pending("pendingApprovalCount")
        send("subscribe", "sync" to interopObject("requestId" to JsonPrimitive("kotlin-replay"), "cursor" to cursor))
        val delta = sync("kotlin-replay")
        assertEquals("replay", delta.text("mode"))
        assertEquals("Replay must resume from snapshot", cursor.number("seq"), delta.number("fromSeq"))
        assertTrue("Replay must include the approval", delta.array("events").any { (it as? JsonObject)?.text("type") == "approval-request" })
        send("approval-respond", "requestId" to JsonPrimitive(approval.text("requestId")), "decision" to JsonPrimitive("allow"))
        assertTrue("Approval resolution must correlate", live("approval-resolved").obj("event").text("requestId") == approval.text("requestId"))
        val toolResult = live("message-upsert").obj("event").obj("message")
        assertEquals("toolResult", toolResult.text("role"))
        assertTrue("Tool result must correlate", toolResult.text("toolCallId") == approval.text("toolCallId"))

        val ask = live("ask-request").obj("event").obj("ask")
        pending("pendingAskCount")
        val answer = ask.array("options").firstOrNull() as? JsonPrimitive ?: throw AssertionError("Missing fixture answer option")
        assertTrue("Fixture answer must be text", answer.isString)
        send("ask-respond", "requestId" to JsonPrimitive(ask.text("requestId")), "answer" to answer)
        assertTrue("Ask resolution must correlate", live("ask-resolved").obj("event").text("requestId") == ask.text("requestId"))
        live("turn-completed")
        // Drain the completion message before asserting the next turn's failure path.
        live("message-upsert")
        send("prompt", "text" to JsonPrimitive("/fail"))
        assertTrue("Fake-host failure must propagate", live("turn-failed").obj("event").text("error").contains("fixture", ignoreCase = true))
    }

    private fun encode(value: String): String = URLEncoder.encode(value, Charsets.UTF_8).replace("+", "%20")
}
