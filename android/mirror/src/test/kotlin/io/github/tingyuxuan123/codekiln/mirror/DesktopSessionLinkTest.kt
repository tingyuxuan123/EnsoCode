package io.github.tingyuxuan123.eaves.mirror

import io.github.tingyuxuan123.eaves.pair.FrameReplay
import io.github.tingyuxuan123.eaves.pair.ReplayRole
import java.io.IOException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class DesktopSessionLinkTest {
    @Test fun `one selected session subscribes after proof and null unsubscribes and clears immediately`() = runTest {
        fixture { f ->
            f.link.selectSession("s")
            runCurrent()
            assertEquals("s", f.session!!.timeline.sessionId)
            assertTrue(f.session!!.loading)
            f.connect()
            val subscribe = f.commands().single { it.type == "subscribe" }
            assertEquals("s", subscribe["sessionId"].linkString())
            assertNotNull((subscribe["sync"] as JsonObject)["requestId"].linkString())
            f.sync(subscribe)
            assertFalse(f.session!!.loading)
            assertEquals(2L, f.session!!.timeline.baseIndex)
            f.link.selectSession(null)
            runCurrent()
            assertNull(f.session)
            assertEquals(JsonNull, f.commands().single()["sessionId"])
            f.hostFrame(snapshot(subscribe))
            assertNull(f.session)
        }
    }

    @Test fun `untrusted session frames never stage and stale request or session cannot settle current sync`() = runTest {
        fixture { f ->
            f.link.selectSession("s")
            f.begin()
            f.hostFrame(snapshot(json("""{"sync":{"requestId":"early"}}""")))
            assertTrue(f.session!!.loading)
            f.prove()
            val first = f.commands().single { it.type == "subscribe" }
            f.link.selectSession("next")
            runCurrent()
            val second = f.commands().single()
            f.sync(first)
            assertEquals("next", f.session!!.timeline.sessionId)
            assertTrue(f.session!!.loading)
            f.hostFrame(snapshot(second, sessionId = "next", requestId = "wrong"))
            assertTrue(f.session!!.loading)
            f.hostFrame(snapshot(second, sessionId = "next"))
            assertFalse(f.session!!.loading)
        }
    }

    @Test fun `authenticated host info controls readonly including omitted flag and same-origin staged metadata`() = runTest {
        fixture { f ->
            assertTrue(f.state.readOnly)
            f.begin()
            f.hostFrame(json("""{"type":"host-info","hostname":"Host"}"""))
            assertTrue(f.state.readOnly)
            f.prove()
            assertFalse(f.state.readOnly)
            f.hostFrame(json("""{"type":"host-info","hostname":"Host","readOnly":true}"""))
            assertTrue(f.state.readOnly)
            f.hostFrame(json("""{"type":"host-info","hostname":"Host","readOnly":"true"}"""))
            assertFalse(f.state.readOnly) // TS uses readOnly === true, not truthiness.
        }
        fixture { f ->
            f.begin()
            val stranger = FrameReplay(f.key, ReplayRole.Host, announce = true)
            f.socket.binary(stranger.seal(json("""{"type":"host-info","hostname":"Other"}""")))
            runCurrent()
            f.prove()
            assertTrue(f.state.readOnly)
        }
    }

    @Test fun `cursor replay reconnects from last baseline and rejects dead generation frames`() = runTest {
        fixture { f ->
            f.link.selectSession("s")
            f.connect()
            f.sync(f.commands().single { it.type == "subscribe" })
            f.hostFrame(event("status", 1, "\"status\":\"running\""))
            assertEquals("running", f.session!!.timeline.status)
            val old = f.socket
            old.failed()
            runCurrent()
            assertTrue(f.state.readOnly)
            assertEquals("running", f.session!!.timeline.status)
            advanceTimeBy(1_000)
            runCurrent()
            f.begin(existing = true)
            f.prove()
            val subscribe = f.commands().single { it.type == "subscribe" }
            assertEquals(json("""{"epoch":"e","seq":1}"""), (subscribe["sync"] as JsonObject)["cursor"])
            old.binary(f.host.seal(snapshot(subscribe)))
            runCurrent()
            assertTrue(f.session!!.loading)
            f.hostFrame(json("""{"type":"session-sync","sessionId":"s","requestId":"${requestId(subscribe)}","cursor":{"epoch":"e","seq":2},"mode":"replay","fromSeq":1,"events":[{"type":"status","sessionId":"s","status":"idle"}]}"""))
            assertFalse(f.session!!.loading)
            assertEquals("idle", f.session!!.timeline.status)
        }
    }

    @Test fun `new hidden connection defers selected body subscription until visibility returns`() = runTest {
        fixture { f ->
            f.readyForPrompt()
            f.hostFrame(event("status", 1, "\"status\":\"running\""))
            f.link.setBackgroundAllowed(true)
            f.link.setVisible(false)
            runCurrent()
            assertEquals("presence", f.commands().single().type)
            f.hostFrame(event("status", 2, "\"status\":\"idle\""))
            assertEquals("idle", f.session!!.timeline.status) // Existing subscription stays live.
            f.socket.failed()
            runCurrent()
            advanceTimeBy(1_000)
            f.begin(existing = true)
            f.prove()
            assertFalse(f.commands().any { it.type == "subscribe" })
            assertEquals("s", f.session!!.timeline.sessionId)
            assertTrue(f.session!!.loading)
            f.hostFrame(catalog("s"))
            assertEquals(listOf("s"), f.state.catalog.map { it.id })
            f.hostFrame(event("worker-exited", 3, "\"future\":true").replace(",\"sessionId\":\"s\"", ""))
            assertTrue(f.commands().isEmpty()) // Host control cannot trigger a new hidden subscription.
            f.link.setVisible(true)
            runCurrent()
            val commands = f.commands()
            assertEquals(listOf("presence", "subscribe"), commands.map { it.type })
            assertEquals(json("""{"epoch":"e","seq":2}"""), (commands.last()["sync"] as JsonObject)["cursor"])
            f.sync(commands.last())
            assertFalse(f.session!!.loading)
        }
    }

    @Test fun `gap resync is delayed beyond host burst dedupe and sync retries terminate`() = runTest {
        fixture { f ->
            f.link.selectSession("s")
            f.connect()
            f.sync(f.commands().single { it.type == "subscribe" })
            f.hostFrame(event("status", 3, "\"status\":\"running\""))
            assertTrue(f.session!!.loading)
            assertTrue(f.commands().isEmpty())
            advanceTimeBy(1_501)
            runCurrent()
            val replay = f.commands().single { it.type == "subscribe" }
            assertEquals(json("""{"epoch":"e","seq":0}"""), (replay["sync"] as JsonObject)["cursor"])
            f.hostFrame(json("""{"type":"session-sync","sessionId":"s","requestId":"${requestId(replay)}","cursor":{"epoch":"e","seq":3},"mode":"replay","fromSeq":2,"events":[{"type":"status","sessionId":"s","status":"idle"}]}"""))
            advanceTimeBy(1_501)
            runCurrent()
            val fresh = f.commands().single { it.type == "subscribe" }
            assertNull((fresh["sync"] as JsonObject)["cursor"])
            repeat(90) {
                f.socket.text("pong")
                advanceTimeBy(1_000)
                runCurrent()
            }
            assertTrue(f.session!!.error)
            assertFalse(f.session!!.loading)
            val attempts = f.commands().filter { it.type == "subscribe" }
            assertTrue(attempts.size in 1..6)
            f.link.retrySession()
            runCurrent()
            assertTrue(f.session!!.loading)
            assertFalse(f.session!!.error)
            assertNotEquals(requestId(fresh), requestId(f.commands().single { it.type == "subscribe" }))
        }
    }

    @Test fun `history is current-session only bounded and merges actual host page shape`() = runTest {
        fixture { f ->
            f.link.selectSession("s")
            f.connect()
            f.sync(f.commands().single { it.type == "subscribe" })
            f.link.loadHistory("other")
            f.link.loadHistory("s")
            f.link.loadHistory("s")
            runCurrent()
            val history = f.commands().single()
            assertEquals("history", history.type)
            assertEquals(JsonPrimitive(2), history["beforeIndex"])
            assertTrue(f.session!!.loadingHistory)
            f.hostFrame(json("""{"type":"history","sessionId":"other","baseIndex":0,"messages":[]}"""))
            assertTrue(f.session!!.loadingHistory)
            f.hostFrame(json("""{"type":"history","sessionId":"s","baseIndex":2,"messages":[{"role":"user","content":[]}]}"""))
            assertTrue(f.session!!.loadingHistory) // Page is outside the requested [0, beforeIndex) range.
            f.hostFrame(json("""{"type":"history","sessionId":"s","baseIndex":0,"messages":[{"role":"user","content":[]},{"role":"assistant","content":[]}]}"""))
            assertFalse(f.session!!.loadingHistory)
            assertEquals(0L, f.session!!.timeline.baseIndex)
            assertEquals(3, f.session!!.timeline.messages.size)
            assertFalse(f.session!!.hasMoreHistory)
            f.link.loadHistory("s")
            runCurrent()
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `actor validates responses against authenticated current synced requests without optimistic removal`() = runTest {
        fixture { f ->
            f.link.selectSession("s")
            f.connect()
            f.sync(f.commands().single { it.type == "subscribe" }, requests = true)
            f.link.respondApproval("s", "approval", "allow")
            runCurrent()
            assertTrue(f.commands().isEmpty()) // No authenticated host-info yet.
            f.hostFrame(json("""{"type":"host-info","hostname":"Host"}"""))
            f.link.respondApproval("other", "approval", "allow")
            f.link.respondApproval("s", "missing", "allow")
            f.link.respondApproval("s", "approval", "ALLOW")
            f.link.respondApproval("s", "protected", "allowSession")
            f.link.respondApproval("s", "reviewing", "deny")
            f.link.respondApproval("s", "expired", "allow")
            f.link.respondAsk("s", "choice", "a") // Exact option has surrounding spaces.
            f.link.respondAsk("s", "choice", "") // This API does not expose cancellation.
            f.link.respondAsk("s", "text", "   ")
            f.link.respondAsk("s", "text", "☃".repeat(400_000)) // UTF-8 wire limit, not a character-only check.
            f.link.respondApproval("s", "approval", "allowSession")
            f.link.respondApproval("s", "approval", "deny") // Duplicate in flight.
            f.link.respondAsk("s", "choice", " a ")
            runCurrent()
            val sent = f.commands()
            assertEquals(listOf("approval-respond", "ask-respond"), sent.map { it.type })
            assertEquals(" a ", sent.last()["answer"].linkString())
            assertEquals(setOf("approval", "choice"), f.session!!.pendingResponses)
            assertEquals(4, f.session!!.timeline.approvals.size)
            assertEquals(2, f.session!!.timeline.asks.size)
            f.hostFrame(event("approval-resolved", 1, "\"requestId\":\"approval\""))
            assertEquals(setOf("choice"), f.session!!.pendingResponses)
            f.hostFrame(json("""{"type":"command-rejected","command":"ask-respond","error":"read-only"}"""))
            assertTrue(f.session!!.pendingResponses.isEmpty())
            assertTrue(f.session!!.responseFailed)
            assertTrue(f.state.readOnly)
        }
    }

    @Test fun `retained hidden session rejects caller writes and old UI commands cannot run after foregrounding`() = runTest {
        fixture { f ->
            f.link.selectSession("s")
            f.connect()
            f.sync(f.commands().single { it.type == "subscribe" }, requests = true)
            f.hostFrame(hostInfo)
            val image = testSessionJpeg()
            fun write() {
                f.link.respondApproval("s", "approval", "allow")
                f.link.respondAsk("s", "choice", " a ")
                f.link.submitImages("s", "hidden image", listOf(image))
                f.link.submitText("s", "hidden text", steer = false)
            }

            f.link.setBackgroundAllowed(true)
            f.link.setVisible(false)
            f.link.setVisible(true)
            write() // Captures the old projection before either lifecycle event reaches the actor.
            runCurrent()
            assertEquals(LinkPhase.Online, f.state.phase)
            assertEquals(listOf("presence", "presence"), f.commands().map { it.type })

            f.link.setVisible(false)
            runCurrent()
            f.commands()
            f.hostFrame(hostInfo) // Authenticated write scope cannot grant foreground authority.
            write()
            runCurrent()
            assertTrue(f.commands().isEmpty())
            assertTrue(f.session!!.pendingResponses.isEmpty())
            assertNull(f.session!!.textAttempt)

            f.link.setVisible(true)
            runCurrent()
            assertEquals("presence", f.commands().single().type)
            f.link.respondApproval("s", "approval", "allow")
            f.link.submitImages("s", "explicit after return", listOf(image))
            runCurrent()
            assertEquals(listOf("approval-respond", "prompt"), f.commands().map { it.type })
            assertEquals(setOf("approval"), f.session!!.pendingResponses)
            val attempt = f.session!!.textAttempt
            assertEquals(SessionCommandPhase.Waiting, attempt?.phase)

            f.link.setVisible(false)
            runCurrent()
            assertEquals("presence", f.commands().single().type)
            assertEquals(setOf("approval"), f.session!!.pendingResponses)
            assertEquals(attempt, f.session!!.textAttempt)
            f.hostFrame(event("approval-resolved", 1, "\"requestId\":\"approval\""))
            f.hostFrame(imageUpsert(2, 3, "explicit after return", listOf(image)))
            assertTrue(f.session!!.pendingResponses.isEmpty())
            assertEquals(attempt?.id, f.session!!.textAttempt?.id)
            assertEquals(SessionCommandPhase.Observed, f.session!!.textAttempt?.phase)
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `failed socket acceptance and response timeout never report successful resolution`() = runTest {
        fixture { f ->
            f.link.selectSession("s")
            f.connect()
            f.sync(f.commands().single { it.type == "subscribe" }, requests = true)
            f.hostFrame(json("""{"type":"host-info","hostname":"Host"}"""))
            f.link.respondAsk("s", "text", "answer")
            runCurrent()
            assertEquals(setOf("text"), f.session!!.pendingResponses)
            advanceTimeBy(10_001)
            runCurrent()
            assertTrue(f.session!!.pendingResponses.isEmpty())
            assertTrue(f.session!!.responseFailed)
            assertEquals(2, f.session!!.timeline.asks.size)
            f.socket.accept = false
            f.link.respondApproval("s", "approval", "allow")
            runCurrent()
            assertTrue(f.session!!.pendingResponses.isEmpty())
            assertEquals(LinkPhase.Offline, f.state.phase)
            assertEquals(4, f.session!!.timeline.approvals.size)
        }
    }

    @Test fun `late authority clears an obsolete response notice and late scope denial still blocks writes`() = runTest {
        fixture { f ->
            f.link.selectSession("s")
            f.connect()
            f.sync(f.commands().single { it.type == "subscribe" }, requests = true)
            f.hostFrame(json("""{"type":"host-info","hostname":"Host"}"""))
            f.link.respondApproval("s", "approval", "allow")
            runCurrent()
            f.commands()
            advanceTimeBy(10_001)
            runCurrent()
            assertTrue(f.session!!.responseFailed)
            f.hostFrame(event("approval-resolved", 1, "\"requestId\":\"approval\""))
            assertFalse(f.session!!.responseFailed)
            f.hostFrame(json("""{"type":"command-rejected","command":"ask-respond","error":"read-only"}"""))
            assertTrue(f.state.readOnly)
            f.link.respondAsk("s", "text", "must not send")
            runCurrent()
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `a replay keeps outstanding replies pending but a replacement marks their outcome unknown`() = runTest {
        fixture { f ->
            f.link.selectSession("s")
            f.connect()
            f.sync(f.commands().single { it.type == "subscribe" }, requests = true)
            f.hostFrame(json("""{"type":"host-info","hostname":"Host"}"""))
            f.link.respondApproval("s", "approval", "allow")
            runCurrent()
            assertEquals("approval-respond", f.commands().single().type)

            f.hostFrame(event("status", 2, "\"status\":\"running\""))
            assertEquals(setOf("approval"), f.session!!.pendingResponses)
            advanceTimeBy(1_501)
            runCurrent()
            val replay = f.commands().single()
            f.hostFrame(json("""{"type":"session-sync","sessionId":"s","requestId":"${requestId(replay)}","cursor":{"epoch":"e","seq":2},"mode":"replay","fromSeq":0,"events":[{"type":"status","sessionId":"s","status":"idle"},{"type":"status","sessionId":"s","status":"running"}]}"""))
            assertEquals(setOf("approval"), f.session!!.pendingResponses)

            f.hostFrame(event("session-invalidated", 3, "\"future\":true"))
            advanceTimeBy(1_501)
            runCurrent()
            f.sync(f.commands().single(), requests = true)
            assertTrue(f.session!!.pendingResponses.isEmpty())
            assertTrue(f.session!!.responseFailed)
            assertTrue(f.session!!.timeline.approvals.any { it.requestId == "approval" })
        }
    }

    @Test fun `switch and revocation prevent responses queued for the abandoned projection`() = runTest {
        fixture { f ->
            f.link.selectSession("s")
            f.connect()
            f.sync(f.commands().single { it.type == "subscribe" }, requests = true)
            f.hostFrame(json("""{"type":"host-info","hostname":"Host"}"""))
            f.link.selectSession(null)
            f.link.respondApproval("s", "approval", "allow")
            runCurrent()
            assertNull(f.session)
            assertEquals(listOf("subscribe"), f.commands().map { it.type })
            f.link.selectSession("s")
            runCurrent()
            advanceTimeBy(1_501)
            runCurrent()
            f.sync(f.commands().single { it.type == "subscribe" }, requests = true)
            f.socket.text("""{"type":"revoked"}""")
            f.link.selectSession("s")
            f.link.respondApproval("s", "approval", "allow")
            runCurrent()
            assertEquals(LinkPhase.Revoked, f.state.phase)
            assertNull(f.session)
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `prompt preserves exact text and waits for a new matching user message without optimistic echo`() = runTest {
        fixture { f ->
            f.link.selectSession("s")
            f.connect()
            f.sync(f.commands().single { it.type == "subscribe" })
            f.link.submitText("s", "hello", steer = false)
            runCurrent()
            assertTrue(f.commands().isEmpty())
            f.hostFrame(json("""{"type":"host-info","hostname":"Host"}"""))
            f.link.submitText("other", "hello", steer = false)
            f.link.submitText("s", "  \n", steer = false)
            f.link.submitText("s", "雪".repeat(32_001), steer = false)
            f.link.submitText("s", "hello", steer = true)
            f.link.submitText("s", "hello", steer = false)
            f.link.submitText("s", "duplicate", steer = false)
            runCurrent()
            assertEquals(json("""{"type":"prompt","sessionId":"s","text":"hello"}"""), f.commands().single())
            assertEquals(SessionCommandPhase.Waiting, f.session!!.textAttempt?.phase)
            assertEquals(1, f.session!!.timeline.messages.size)
            f.hostFrame(event("message-upsert", 1, """"index":2,"message":{"role":"user","content":[{"type":"text","text":"hello"}]}"""))
            f.hostFrame(event("message-upsert", 2, """"index":3,"message":{"role":"assistant","content":[{"type":"text","text":"hello"}]}"""))
            assertEquals(SessionCommandPhase.Waiting, f.session!!.textAttempt?.phase)
            f.hostFrame(event("message-upsert", 3, """"index":4,"message":{"role":"user","content":[{"type":"text","text":"hello"}]}"""))
            assertEquals(SessionCommandPhase.Observed, f.session!!.textAttempt?.phase)
        }
    }

    @Test fun `image-only prompt uses existing wire fields and absent text in authoritative echo is accepted`() = runTest {
        fixture { f ->
            f.readyForPrompt()
            val image = testSessionJpeg()
            val before = f.session!!.timeline
            val selection = mutableListOf(image)
            f.link.submitImages("s", " \n", selection)
            selection.clear() // A mutable caller list cannot change the actor's queued command.
            runCurrent()
            assertEquals(json("""{"type":"prompt","sessionId":"s","text":"","images":[{"data":"${image.data}","mimeType":"image/jpeg"}]}"""),
                f.commands().singleOrNull())
            assertEquals(before, f.session!!.timeline)
            val attempt = f.session!!.textAttempt!!
            assertEquals(SessionTextAttempt(attempt.id, "", SessionCommandPhase.Waiting, listOf(image.fingerprint)), attempt)
            f.hostFrame(imageUpsert(1, 2, null, listOf(image))) // Not later than the send tail.
            f.hostFrame(imageUpsert(2, 3, "", emptyList()))
            assertEquals(SessionCommandPhase.Waiting, f.session!!.textAttempt?.phase)
            f.hostFrame(imageUpsert(3, 4, null, listOf(image)))
            assertEquals(attempt.copy(phase = SessionCommandPhase.Observed), f.session!!.textAttempt)
        }
    }

    @Test fun `image caption observation requires exact text MIME data and image order`() = runTest {
        fixture { f ->
            f.readyForPrompt()
            val text = " exact 雪\n"
            val images = listOf(testSessionJpeg(), testSessionJpeg(pixel = 42))
            f.link.submitImages("s", text, images)
            f.link.submitText("s", "must not strip attachments or send again", steer = false)
            runCurrent()
            val prompt = f.commands().singleOrNull()
            assertEquals(text, prompt?.get("text").linkString())
            assertEquals(json("""{"images":[{"data":"${images[0].data}","mimeType":"image/jpeg"},{"data":"${images[1].data}","mimeType":"image/jpeg"}]}""")["images"],
                prompt?.get("images"))
            f.hostFrame(imageUpsert(1, 3, text, emptyList()))
            f.hostFrame(imageUpsert(2, 4, text, images.reversed()))
            f.hostFrame(imageUpsert(3, 5, text.trim(), images))
            f.hostFrame(imageUpsert(4, 6, text, listOf(images[0], images[1].copy(mimeType = "image/png"))))
            f.hostFrame(imageUpsert(5, 7, text, listOf(images[0], testSessionJpeg(pixel = 43))))
            f.hostFrame(imageUpsert(6, 8, text, images, role = "assistant"))
            assertEquals(SessionCommandPhase.Waiting, f.session!!.textAttempt?.phase)
            f.hostFrame(imageUpsert(6, 9, text, images)) // Stale Pair cursor, even with a higher index.
            assertEquals(SessionCommandPhase.Waiting, f.session!!.textAttempt?.phase)
            f.hostFrame(imageUpsert(7, 9, text, images))
            assertEquals(SessionCommandPhase.Observed, f.session!!.textAttempt?.phase)
        }
    }

    @Test fun `attachments never send for stale selection read-only running failed or oversized prompt`() = runTest {
        fixture { f ->
            f.readyForPrompt()
            val image = testSessionJpeg()
            f.link.submitImages("other", "wrong session", listOf(image))
            f.socket.binary(f.host.seal(json("""{"type":"host-info","readOnly":true}""")))
            f.link.submitImages("s", "scope changed before write", listOf(image))
            runCurrent()
            assertTrue(f.state.readOnly)
            f.link.submitImages("s", "known readonly", listOf(image))
            f.hostFrame(hostInfo)
            f.socket.binary(f.host.seal(event("status", 1, "\"status\":\"running\"")))
            f.link.submitImages("s", "became running before write", listOf(image))
            runCurrent()
            f.link.submitImages("s", "known running", listOf(image))
            f.hostFrame(event("status", 2, "\"status\":\"failed\""))
            f.link.submitImages("s", "not idle", listOf(image))
            f.hostFrame(event("status", 3, "\"status\":\"idle\""))
            f.link.submitImages("s", "raw over budget", listOf(testSessionJpeg(SESSION_IMAGE_BYTES + 1)))
            f.link.submitImages("s", "\u0000".repeat(SESSION_TEXT_LIMIT), listOf(testSessionJpeg(SESSION_IMAGE_BYTES)))
            f.link.submitImages("s", "cannot fall back to text", listOf(image.copy(data = "not-jpeg")))
            f.link.selectSession(null)
            f.link.submitImages("s", "no longer selected", listOf(image))
            runCurrent()
            assertEquals(listOf("subscribe"), f.commands().map { it.type })
        }
    }

    @Test fun `attachment work captured before reauthentication cannot send into the same session and epoch`() = runTest {
        fixture { f ->
            f.readyForPrompt()
            val image = testSessionJpeg()
            val delayed = object : AbstractList<SessionImage>() {
                override val size = 1
                override fun get(index: Int): SessionImage {
                    // Simulate the actor fully reconnecting while the caller snapshots/validates the attachment.
                    f.socket.failed()
                    runCurrent()
                    advanceTimeBy(1_000)
                    runCurrent()
                    f.begin(existing = true)
                    f.prove()
                    f.sync(f.commands().single { it.type == "subscribe" })
                    f.hostFrame(hostInfo)
                    return image
                }
            }
            f.link.submitImages("s", "from previous authentication", delayed)
            runCurrent()
            assertTrue(f.commands().isEmpty())
            assertNull(f.session!!.textAttempt)
            f.link.submitImages("s", "explicit in current authentication", listOf(image))
            runCurrent()
            assertEquals("prompt", f.commands().single().type)
        }
    }

    @Test fun `attachment timeout and disconnect retain only attempt identity without resend`() = runTest {
        fixture { f ->
            f.readyForPrompt()
            val image = testSessionJpeg()
            f.link.submitImages("s", "keep first draft", listOf(image))
            runCurrent()
            assertEquals("prompt", f.commands().singleOrNull()?.type)
            advanceTimeBy(10_001)
            runCurrent()
            assertEquals(SessionCommandPhase.Unconfirmed, f.session!!.textAttempt?.phase)
            assertEquals(listOf(image.fingerprint), f.session!!.textAttempt?.imageFingerprints)
            assertTrue(f.commands().isEmpty())
            f.link.submitImages("s", "keep second draft", listOf(image))
            runCurrent()
            assertEquals("prompt", f.commands().single().type)
            f.socket.failed()
            runCurrent()
            advanceTimeBy(1_000)
            runCurrent()
            f.begin(existing = true)
            f.prove()
            f.sync(f.commands().single { it.type == "subscribe" })
            f.hostFrame(hostInfo)
            assertEquals(SessionCommandPhase.Unconfirmed, f.session!!.textAttempt?.phase)
            assertEquals("keep second draft", f.session!!.textAttempt?.text)
            assertEquals(listOf(image.fingerprint), f.session!!.textAttempt?.imageFingerprints)
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `attachment prompt and queue edit exclude each other`() = runTest {
        for (queueFirst in listOf(true, false)) fixture { f ->
            f.readyForPrompt()
            f.hostFrame(json("""{"type":"catalog","entries":[{"id":"s","title":"Task","status":"idle","projectName":"P","queued":[{"id":"q","text":"before"}]}]}"""))
            if (queueFirst) f.link.queueAction("s", QueueCommand.Update, "q", "after")
            f.link.submitImages("s", "", listOf(testSessionJpeg()))
            if (!queueFirst) f.link.queueAction("s", QueueCommand.Update, "q", "after")
            runCurrent()
            assertEquals(listOf(if (queueFirst) "queue-update" else "prompt"), f.commands().map { it.type })
        }
    }

    @Test fun `explicit steer and stop are running only and stop waits for authoritative status`() = runTest {
        fixture { f ->
            f.link.selectSession("s")
            f.connect()
            f.sync(f.commands().single { it.type == "subscribe" })
            f.hostFrame(json("""{"type":"host-info","hostname":"Host"}"""))
            f.link.stopSession("s")
            runCurrent()
            assertTrue(f.commands().isEmpty())
            f.hostFrame(event("status", 1, "\"status\":\"running\""))
            f.link.submitText("s", " not trimmed \n", steer = false)
            f.link.submitText("s", " not trimmed \n", steer = true)
            f.link.stopSession("s")
            f.link.stopSession("s")
            runCurrent()
            assertEquals(listOf(json("""{"type":"steer","sessionId":"s","text":" not trimmed \n"}"""),
                json("""{"type":"abort","sessionId":"s"}""")), f.commands())
            assertEquals(SessionCommandPhase.Waiting, f.session!!.stopPhase)
            assertEquals("running", f.session!!.timeline.status)
            f.hostFrame(event("turn-completed", 2, "\"turnId\":\"old\""))
            assertNull(f.session!!.stopPhase)
            advanceTimeBy(10_001)
            runCurrent()
            assertEquals(SessionCommandPhase.Unconfirmed, f.session!!.textAttempt?.phase)
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `disconnect keeps attempt unconfirmed without resending and scope rejection blocks further writes`() = runTest {
        fixture { f ->
            f.link.selectSession("s")
            f.connect()
            f.sync(f.commands().single { it.type == "subscribe" })
            f.hostFrame(json("""{"type":"host-info","hostname":"Host"}"""))
            f.link.submitText("s", "keep this", steer = false)
            runCurrent()
            assertEquals("prompt", f.commands().single().type)
            f.socket.failed()
            runCurrent()
            assertEquals(SessionCommandPhase.Unconfirmed, f.session!!.textAttempt?.phase)
            advanceTimeBy(1_000)
            runCurrent()
            f.begin(existing = true)
            f.prove()
            f.sync(f.commands().single { it.type == "subscribe" })
            f.hostFrame(json("""{"type":"host-info","hostname":"Host"}"""))
            assertTrue(f.commands().isEmpty())
            f.link.submitText("s", "try again", steer = false)
            runCurrent()
            assertEquals("prompt", f.commands().single().type)
            f.hostFrame(json("""{"type":"command-rejected","command":"prompt","error":"read-only"}"""))
            assertTrue(f.state.readOnly)
            assertEquals(SessionCommandPhase.Rejected, f.session!!.textAttempt?.phase)
            f.link.submitText("s", "no", steer = false)
            runCurrent()
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `creation sends one ID-only spawn and waits for matching fresh catalog and authoritative sync`() = runTest {
        fixture { f ->
            f.connectForCreation()
            f.link.createTask(launch)
            f.link.createTask(launch)
            runCurrent()
            val spawn = f.commands().single()
            val id = spawn["sessionId"].linkString()!!
            assertEquals(id, java.util.UUID.fromString(id).toString())
            assertEquals(json("""{"type":"spawn","sessionId":"$id","projectId":"p","providerId":"d","modelId":"m",
                "approvalMode":"auto-edits","reasoningEnabled":true,"thinkingLevel":"xhigh"}"""), spawn)
            assertEquals(DesktopCreation(id, CreationPhase.Creating), f.state.creation)
            assertNull(f.session)
            f.link.dismissCreation(id)
            f.link.selectSession(null) // NewTask routing is normally a no-op.
            f.hostFrame(catalog("unrelated"))
            val older = f.host.seal(catalog(id))
            f.hostFrame(catalog("another"))
            f.socket.binary(older)
            f.hostFrame(snapshot(json("""{"sync":{"requestId":"early"}}"""), sessionId = id))
            assertEquals(CreationPhase.Creating, f.state.creation?.phase)
            assertTrue(f.commands().isEmpty())

            f.hostFrame(catalog(id))
            val subscribe = f.commands().single()
            assertEquals("subscribe", subscribe.type)
            assertEquals(id, subscribe["sessionId"].linkString())
            assertNull((subscribe["sync"] as JsonObject)["cursor"])
            assertEquals(DesktopCreation(id, CreationPhase.Created), f.state.creation)
            assertTrue(f.session!!.loading)
            f.link.dismissCreation(id)
            f.link.selectSession(id) // UI adopts the actor-selected session.
            f.hostFrame(catalog(id))
            f.hostFrame(snapshot(subscribe, sessionId = id, requestId = "stale", empty = true))
            assertTrue(f.commands().isEmpty())
            f.hostFrame(snapshot(subscribe, sessionId = id, empty = true))
            assertEquals(json("""{"type":"prompt","sessionId":"$id","text":" first text\n"}"""), f.commands().single())
            assertEquals(SessionCommandPhase.Waiting, f.session!!.textAttempt?.phase)
            assertTrue(f.session!!.timeline.messages.isEmpty())
            f.hostFrame(snapshot(subscribe, sessionId = id, empty = true))
            f.hostFrame(catalog(id))
            assertTrue(f.commands().isEmpty())
            f.hostFrame(event("message-upsert", 1,
                """"index":0,"message":{"role":"user","content":[{"type":"text","text":" first text\n"}]}""", sessionId = id))
            assertEquals(SessionCommandPhase.Observed, f.session!!.textAttempt?.phase)
        }
    }

    @Test fun `retained hide cancels automatic selection before catalog and first prompt after catalog`() = runTest {
        fixture { f ->
            f.connectForCreation()
            f.link.setBackgroundAllowed(true)
            f.link.createTask(launch)
            runCurrent()
            val id = f.commands().single()["sessionId"].linkString()!!
            f.link.setVisible(false)
            runCurrent()
            assertEquals(LinkPhase.Online, f.state.phase)
            assertEquals("presence", f.commands().single().type)
            f.hostFrame(catalog(id))
            assertEquals(listOf(id), f.state.catalog.map { it.id })
            assertEquals(DesktopCreation(id, CreationPhase.Unconfirmed), f.state.creation)
            assertNull(f.session)
            assertTrue(f.commands().isEmpty())
        }
        fixture { f ->
            f.connectForCreation()
            f.link.setBackgroundAllowed(true)
            f.link.createTask(launch)
            runCurrent()
            val id = f.commands().single()["sessionId"].linkString()!!
            f.hostFrame(catalog(id))
            val subscribe = f.commands().single()
            f.link.setVisible(false)
            f.link.setVisible(true)
            f.hostFrame(snapshot(subscribe, sessionId = id, empty = true))
            assertEquals(LinkPhase.Online, f.state.phase)
            assertEquals(DesktopCreation(id, CreationPhase.Created), f.state.creation)
            assertFalse(f.session!!.loading)
            assertNull(f.session!!.textAttempt)
            assertEquals(listOf("presence", "presence"), f.commands().map { it.type })
        }
    }

    @Test fun `create cannot use background host scope or a queued request from an old visible generation`() = runTest {
        fixture { f ->
            f.connectForCreation()
            f.link.setBackgroundAllowed(true)
            f.link.setVisible(false)
            f.link.setVisible(true)
            f.link.createTask(launch)
            runCurrent()
            assertEquals(LinkPhase.Online, f.state.phase)
            assertEquals(listOf("presence", "presence"), f.commands().map { it.type })
            f.link.dismissCreation(null)
            f.link.setVisible(false)
            runCurrent()
            f.commands()
            f.hostFrame(hostInfo)
            f.link.createTask(launch)
            runCurrent()
            assertTrue(f.commands().isEmpty())
            f.link.dismissCreation(null)
            f.link.setVisible(true)
            runCurrent()
            assertEquals("presence", f.commands().single().type)
            f.link.createTask(launch)
            runCurrent()
            assertEquals("spawn", f.commands().single().type)
        }
    }

    @Test fun `creation metadata stages only the newest matching proof origin and resets on lost host`() = runTest {
        fixture { f ->
            f.begin()
            val stranger = FrameReplay(f.key, ReplayRole.Host, announce = true)
            f.socket.binary(stranger.seal(projects.replace("\"p\"", "\"other\"")))
            val older = f.host.seal(projects.replace("\"p\"", "\"old\""))
            f.hostFrame(projects)
            f.socket.binary(older)
            f.hostFrame(providers)
            assertNull(f.state.projects)
            assertNull(f.state.providers)
            f.link.createTask(launch)
            runCurrent()
            assertEquals(DesktopCreation(null, CreationPhase.Unavailable), f.state.creation)
            f.prove()
            assertEquals(listOf(DesktopProject("p", "Project")), f.state.projects)
            assertEquals(listOf(DesktopProvider("d", "Provider", listOf(DesktopModel("m", "m")))), f.state.providers)
            assertFalse(f.commands().any { it.type == "spawn" })
            f.socket.text("""{"type":"host-offline"}""")
            runCurrent()
            assertNull(f.state.projects)
            assertNull(f.state.providers)
        }
    }

    @Test fun `creation validates latest metadata selection scope and exact text bounds`() = runTest {
        fixture { f ->
            f.connect()
            f.hostFrame(projects)
            f.hostFrame(providers)
            f.commands()
            f.link.createTask(launch) // No authenticated scope yet.
            runCurrent()
            assertTrue(f.commands().isEmpty())
            f.link.dismissCreation(null)
            f.hostFrame(hostInfo)
            f.hostFrame(json("""{"type":"providers","providers":[{"id":"d","name":"Provider","models":[{"id":"next"}]}]}"""))
            f.link.createTask(launch)
            f.link.dismissCreation(null)
            f.link.createTask(launch.copy(modelId = "next", text = " \n "))
            f.link.dismissCreation(null)
            f.link.createTask(launch.copy(modelId = "next", text = "x".repeat(SESSION_TEXT_LIMIT + 1)))
            f.link.dismissCreation(null)
            f.link.createTask(launch.copy(projectId = "missing", modelId = "next"))
            runCurrent()
            assertEquals(DesktopCreation(null, CreationPhase.Unavailable), f.state.creation)
            assertTrue(f.commands().isEmpty())
            f.hostFrame(providers)
            f.link.dismissCreation(null)
            f.link.selectSession("other")
            runCurrent()
            assertEquals("subscribe", f.commands().single().type)
            f.link.createTask(launch)
            runCurrent()
            assertTrue(f.commands().isEmpty())
            f.link.dismissCreation(null)
            f.link.selectSession(null)
            runCurrent()
            f.commands()
            f.link.createTask(launch.copy(approvalMode = TaskApprovalMode.Assistant, thinkingLevel = null))
            runCurrent()
            val spawn = f.commands().single()
            assertEquals(json("""{"type":"spawn","sessionId":"${spawn["sessionId"].linkString()}","projectId":"p",
                "providerId":"d","modelId":"m","approvalMode":"assistant"}"""), spawn)
        }
    }

    @Test fun `timeout and late scope rejection never open or retry a creation`() = runTest {
        fixture { f ->
            f.connectForCreation()
            f.link.createTask(launch)
            runCurrent()
            val id = f.commands().single()["sessionId"].linkString()!!
            advanceTimeBy(15_001)
            runCurrent()
            assertEquals(DesktopCreation(id, CreationPhase.Unconfirmed), f.state.creation)
            f.link.dismissCreation("another")
            f.link.createTask(launch)
            runCurrent()
            assertEquals(DesktopCreation(id, CreationPhase.Unconfirmed), f.state.creation)
            assertTrue(f.commands().isEmpty())
            f.hostFrame(catalog(id))
            assertNull(f.session)
            assertTrue(f.commands().isEmpty())
            f.hostFrame(readOnlySpawn)
            assertTrue(f.state.readOnly)
            assertEquals(DesktopCreation(id, CreationPhase.Unconfirmed), f.state.creation)
            assertTrue(f.commands().isEmpty())
            f.link.selectSession(id)
            runCurrent()
            f.hostFrame(snapshot(f.commands().single(), sessionId = id, empty = true))
            assertTrue(f.commands().isEmpty())
            f.link.dismissCreation(id)
            runCurrent()
            assertNull(f.state.creation)
        }
    }

    @Test fun `read-only rejection settles a pending spawn before any session is selected`() = runTest {
        fixture { f ->
            f.connectForCreation()
            f.link.createTask(launch)
            runCurrent()
            val id = f.commands().single()["sessionId"].linkString()!!
            f.hostFrame(readOnlySpawn)
            assertTrue(f.state.readOnly)
            assertEquals(DesktopCreation(id, CreationPhase.Rejected), f.state.creation)
            f.hostFrame(catalog(id))
            assertNull(f.session)
            assertTrue(f.commands().isEmpty())
            f.link.dismissCreation(id)
            runCurrent()
            assertNull(f.state.creation)
        }
    }

    @Test fun `created scope denial is sticky for first text even after a fresh writable host frame`() = runTest {
        fixture { f ->
            f.connectForCreation()
            f.link.createTask(launch)
            runCurrent()
            val id = f.commands().single()["sessionId"].linkString()!!
            f.hostFrame(catalog(id))
            val subscribe = f.commands().single()
            val olderScope = f.host.seal(hostInfo)
            f.hostFrame(readOnlySpawn)
            f.socket.binary(olderScope)
            runCurrent()
            assertTrue(f.state.readOnly)
            f.hostFrame(hostInfo)
            assertFalse(f.state.readOnly)
            f.hostFrame(snapshot(subscribe, sessionId = id, empty = true))
            assertNull(f.session!!.textAttempt)
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `explicitly dismissing uncertainty permits only a new ID and never resends the old launch`() = runTest {
        fixture { f ->
            f.connectForCreation()
            f.link.createTask(launch)
            runCurrent()
            val firstId = f.commands().single()["sessionId"].linkString()!!
            advanceTimeBy(15_001)
            runCurrent()
            f.link.dismissCreation(firstId)
            f.link.createTask(launch.copy(text = "second explicit draft"))
            runCurrent()
            val secondId = f.commands().single()["sessionId"].linkString()!!
            assertNotEquals(firstId, secondId)
            f.hostFrame(catalog(firstId))
            assertNull(f.session)
            assertTrue(f.commands().isEmpty())
            f.hostFrame(catalog(secondId))
            f.hostFrame(snapshot(f.commands().single(), sessionId = secondId, empty = true))
            assertEquals("second explicit draft", f.commands().single()["text"].linkString())
        }
    }

    @Test fun `authoritative session invalidation before baseline cancels the pending first text`() = runTest {
        fixture { f ->
            f.connectForCreation()
            f.link.createTask(launch)
            runCurrent()
            val id = f.commands().single()["sessionId"].linkString()!!
            f.hostFrame(catalog(id))
            val subscribe = f.commands().single()
            f.hostFrame(event("session-invalidated", 1, "\"future\":true", sessionId = id))
            f.hostFrame(snapshot(subscribe, sessionId = id, empty = true))
            advanceTimeBy(1_501)
            runCurrent()
            val replacement = f.commands().single()
            f.hostFrame(snapshot(replacement, sessionId = id, empty = true).replace("\"seq\":0", "\"seq\":1"))
            assertNull(f.session!!.textAttempt)
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `failed fresh sync cancels first text even if a later baseline succeeds`() = runTest {
        fixture { f ->
            f.connectForCreation()
            f.link.createTask(launch)
            runCurrent()
            val id = f.commands().single()["sessionId"].linkString()!!
            f.hostFrame(catalog(id))
            val subscribe = f.commands().single()
            f.hostFrame(snapshot(subscribe, sessionId = id, empty = true).replace("\"status\":\"idle\"", "\"status\":false"))
            advanceTimeBy(1_501)
            runCurrent()
            f.hostFrame(snapshot(f.commands().single(), sessionId = id, empty = true))
            assertNull(f.session!!.textAttempt)
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `disconnect leaves unconfirmed ID and a reauthenticated catalog cannot restart creation`() = runTest {
        fixture { f ->
            f.connectForCreation()
            f.link.createTask(launch)
            runCurrent()
            val id = f.commands().single()["sessionId"].linkString()!!
            val oldSocket = f.socket
            val oldCatalog = f.host.seal(catalog(id))
            f.socket.failed()
            runCurrent()
            assertEquals(DesktopCreation(id, CreationPhase.Unconfirmed), f.state.creation)
            advanceTimeBy(1_000)
            f.begin(existing = true)
            f.hostFrame(catalog(id)) // Same-origin bootstrap catalog from the next proof.
            oldSocket.binary(oldCatalog)
            f.prove()
            f.hostFrame(hostInfo)
            assertEquals(listOf(id), f.state.catalog.map { it.id })
            assertEquals(DesktopCreation(id, CreationPhase.Unconfirmed), f.state.creation)
            assertNull(f.session)
            assertFalse(f.commands().any { it.type in setOf("spawn", "prompt", "subscribe") })
        }
    }

    @Test fun `selecting away from either creation stage abandons automatic selection and text`() = runTest {
        fixture { f ->
            f.connectForCreation()
            f.link.createTask(launch)
            runCurrent()
            val id = f.commands().single()["sessionId"].linkString()!!
            f.link.selectSession("other")
            f.hostFrame(catalog(id))
            assertEquals("other", f.session!!.timeline.sessionId)
            assertEquals(DesktopCreation(id, CreationPhase.Unconfirmed), f.state.creation)
            assertEquals("other", f.commands().single()["sessionId"].linkString())
        }
        fixture { f ->
            f.connectForCreation()
            f.link.createTask(launch)
            runCurrent()
            val id = f.commands().single()["sessionId"].linkString()!!
            f.hostFrame(catalog(id))
            val firstSync = f.commands().single()
            f.link.selectSession(null)
            f.link.selectSession(id)
            runCurrent()
            assertNull(f.state.creation)
            val secondSync = f.commands().last()
            assertNotEquals(requestId(firstSync), requestId(secondSync))
            f.hostFrame(snapshot(firstSync, sessionId = id, empty = true))
            f.hostFrame(snapshot(secondSync, sessionId = id, empty = true))
            assertTrue(f.commands().isEmpty())
            assertNull(f.session!!.textAttempt)
        }
    }

    @Test fun `no automatic text follows a busy baseline or an expired or reset sync`() = runTest {
        fixture { f ->
            f.connectForCreation()
            f.link.createTask(launch)
            runCurrent()
            val id = f.commands().single()["sessionId"].linkString()!!
            f.hostFrame(catalog(id))
            val subscribe = f.commands().single()
            f.hostFrame(snapshot(subscribe, sessionId = id, empty = true, status = "running"))
            f.hostFrame(event("status", 1, "\"status\":\"idle\"", sessionId = id))
            assertFalse(f.session!!.loading)
            assertTrue(f.commands().isEmpty())
        }
        fixture { f ->
            f.connectForCreation()
            f.link.createTask(launch)
            runCurrent()
            val id = f.commands().single()["sessionId"].linkString()!!
            f.hostFrame(catalog(id))
            val subscribe = f.commands().single()
            advanceTimeBy(15_001)
            runCurrent()
            f.commands() // Ordinary session-sync retry is allowed.
            f.hostFrame(snapshot(subscribe, sessionId = id, empty = true))
            assertEquals(DesktopCreation(id, CreationPhase.Created), f.state.creation)
            assertTrue(f.commands().isEmpty())
        }
        fixture { f ->
            f.connectForCreation()
            f.link.createTask(launch)
            runCurrent()
            val id = f.commands().single()["sessionId"].linkString()!!
            f.hostFrame(catalog(id))
            f.commands()
            f.socket.failed()
            runCurrent()
            advanceTimeBy(1_000)
            f.begin(existing = true)
            f.prove()
            f.hostFrame(hostInfo)
            f.hostFrame(snapshot(f.commands().single { it.type == "subscribe" }, sessionId = id, empty = true))
            assertTrue(f.commands().isEmpty())
            assertNull(f.session!!.textAttempt)
        }
    }

    private fun TestScope.fixture(block: (Fixture) -> Unit) {
        val fixture = Fixture(this)
        try { block(fixture) } finally {
            fixture.link.close()
            runCurrent()
            advanceTimeBy(1_001)
            runCurrent()
        }
    }

    private class Fixture(val scope: TestScope) {
        val key = ByteArray(32)
        val sockets = mutableListOf<FakeSocket>()
        var host = FrameReplay(key, ReplayRole.Host, announce = true)
        val socket get() = sockets.last()
        val link = DesktopLink(PairCredentials("pair-1", "token", key, "Eaves", "https://example.test"),
            ::modern, false, StandardTestDispatcher(scope.testScheduler), ::elapsedMillis, ::jitter,
            ::openSocket, wallMillis = ::wallMillis)
        val state get() = link.state.value
        val session get() = state.session

        private fun modern() = Unit
        private fun elapsedMillis(): Long = scope.testScheduler.currentTime
        private fun wallMillis(): Long = 1
        private fun jitter(): Double = 0.5
        private fun openSocket(request: Request, listener: WebSocketListener): WebSocket {
            val opened = FakeSocket(request, listener)
            sockets.add(opened)
            return opened
        }

        fun begin(existing: Boolean = false) {
            if (!existing) link.setVisible(true)
            scope.runCurrent()
            socket.opened()
            socket.text("pong")
            socket.text("""{"type":"host-online"}""")
            scope.runCurrent()
            host.peerReset()
        }
        fun prove() {
            for (frame in socket.sent.toList()) host.open(frame)
            socket.sent.clear()
            hostFrame(json("""{"type":"replay-hello"}"""))
            assertEquals(LinkPhase.Online, state.phase)
        }
        fun connect() { begin(); prove() }
        fun readyForPrompt() {
            link.selectSession("s")
            connect()
            sync(commands().single { it.type == "subscribe" })
            hostFrame(hostInfo)
        }
        fun connectForCreation() {
            connect()
            hostFrame(hostInfo)
            hostFrame(projects)
            hostFrame(providers)
            commands()
        }
        fun commands(): List<JsonObject> {
            val commands = mutableListOf<JsonObject>()
            for (frame in socket.sent) {
                val opened = host.open(frame)
                if (opened != null) commands.add(opened.payload)
            }
            socket.sent.clear()
            return commands
        }
        fun hostFrame(frame: JsonObject) { socket.binary(host.seal(frame)); scope.runCurrent() }
        fun sync(command: JsonObject, requests: Boolean = false) = hostFrame(snapshot(command, requests = requests))
    }

    private class FakeSocket(private val request: Request, private val listener: WebSocketListener) : WebSocket {
        val sent = mutableListOf<ByteArray>()
        var accept = true
        override fun request() = request
        override fun queueSize() = 0L
        override fun send(text: String) = accept
        override fun send(bytes: ByteString): Boolean {
            if (!accept) return false
            sent.add(bytes.toByteArray())
            return true
        }
        override fun close(code: Int, reason: String?) = false
        override fun cancel() = Unit
        fun opened() = listener.onOpen(this, Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(101).message("Upgrade").build())
        fun text(value: String) = listener.onMessage(this, value)
        fun binary(value: ByteArray) = listener.onMessage(this, value.toByteString())
        fun failed() = listener.onFailure(this, IOException(), null)
    }

    private companion object {
        val launch = TaskLaunch("p", "d", "m", TaskApprovalMode.AutoEdits, TaskThinkingLevel.XHigh, " first text\n")
        val hostInfo = json("""{"type":"host-info","hostname":"Host"}""")
        val projects = json("""{"type":"projects","projects":[{"id":"p","name":"Project","path":"/not-for-mobile"}]}""")
        val providers = json("""{"type":"providers","providers":[{"id":"d","name":"Provider","models":[{"id":"m"}]}]}""")
        val readOnlySpawn = json("""{"type":"command-rejected","command":"spawn","error":"read-only"}""")
        fun catalog(id: String) = json("""{"type":"catalog","entries":[{"id":"$id","title":"Task","projectName":"Project","status":"idle"}]}""")
        val JsonObject.type get() = get("type").linkString()
        fun json(text: String) = Json.parseToJsonElement(text) as JsonObject
        fun requestId(command: JsonObject) = (command["sync"] as JsonObject)["requestId"].linkString()!!
        fun snapshot(command: JsonObject, sessionId: String = "s", requestId: String = requestId(command), requests: Boolean = false,
            empty: Boolean = false, status: String = "idle"): JsonObject {
            val pending = if (requests) """, "pendingApprovals":[
                {"requestId":"approval","tool":"shell","kind":"command","summary":"Review"},
                {"requestId":"protected","tool":"shell","kind":"command","summary":"Review","protected":"delete"},
                {"requestId":"reviewing","tool":"shell","kind":"command","summary":"Review","phase":"reviewing"},
                {"requestId":"expired","tool":"shell","kind":"command","summary":"Review","expiresAt":1}],
                "pendingAsks":[{"requestId":"choice","question":"Pick","options":[" a ","b"],"selectionOnly":true},
                {"requestId":"text","question":"Explain"}]""" else ""
            val messages = if (empty) "[]" else """[{"role":"user","content":[{"type":"text","text":"hello"}]}]"""
            return json("""{"type":"session-sync","sessionId":"$sessionId","requestId":"$requestId","cursor":{"epoch":"e","seq":0},"mode":"snapshot","snapshot":{"type":"snapshot","sessions":[{"sessionId":"$sessionId","identity":{"sessionId":"$sessionId","generation":"g"},"baseIndex":${if (empty) 0 else 2},"messages":$messages,"status":"$status"$pending}]}}""")
        }
        fun event(type: String, seq: Int, fields: String, sessionId: String = "s") = json("""{"type":"agent-event","cursor":{"epoch":"e","seq":$seq},"event":{"type":"$type","sessionId":"$sessionId",$fields}}""")
        fun imageUpsert(seq: Int, index: Int, text: String?, images: List<SessionImage>, role: String = "user"): JsonObject {
            val parts = listOfNotNull(text?.let { """{"type":"text","text":${JsonPrimitive(it)}}""" }) +
                images.map { """{"type":"image","data":"${it.data}","mimeType":"${it.mimeType}"}""" }
            return event("message-upsert", seq, """"index":$index,"message":{"role":"$role","content":[${parts.joinToString()}]}""")
        }
        fun JsonObject.replace(old: String, new: String) = json(toString().replace(old, new))
    }
}
