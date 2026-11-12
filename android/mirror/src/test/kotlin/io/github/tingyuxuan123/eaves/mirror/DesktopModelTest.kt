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
import kotlinx.serialization.json.JsonObject
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
class DesktopModelTest {
    @Test fun `full catalog keeps exact model ids without inventing a local default`() = runTest {
        fixture { f ->
            f.ready()
            assertEquals("p", f.task?.providerId)
            assertEquals("old", f.task?.modelId)
            f.catalog(row(model = "unknown", provider = "unknown-provider"))
            assertEquals("unknown-provider", f.task?.providerId)
            assertEquals("unknown", f.task?.modelId)
            for (extra in listOf("", "\"providerId\":\"p\"", "\"modelId\":\"old\"",
                "\"providerId\":false,\"modelId\":\"old\"", "\"providerId\":\"p\",\"modelId\":null",
                "\"providerId\":\"p\",\"modelId\":\" \"",
                "\"providerId\":\"${"p".repeat(513)}\",\"modelId\":\"old\"")) {
                f.catalog("""{"id":"s","title":"Task","projectName":"P","status":"idle"${if (extra.isEmpty()) "" else ",$extra"}}""")
                assertNotNull(f.task)
                assertNull("provider: $extra", f.task?.providerId)
                assertNull("model: $extra", f.task?.modelId)
            }
        }
    }

    @Test fun `slim archived malformed and duplicate rows cannot project or confirm a model`() = runTest {
        fixture { f ->
            f.ready(); f.choose(); runCurrent(); f.commands()
            for (rows in listOf("""{"id":"s","title":"Slim","status":"idle","providerId":"p","modelId":"next"}""",
                row(model = "next", archived = true),
                """{"id":"s","title":"Bad","projectName":false,"status":"idle","providerId":"p","modelId":"next"}""",
                "${row(model = "next")},${row()}", "${row(model = "next")},{\"id\":\"s\"}",
                "{\"id\":\"s\"},${row(model = "next")}")) {
                f.catalog(rows)
                assertEquals(SessionCommandPhase.Waiting, f.phase)
                f.task?.let {
                    assertNull(it.providerId); assertNull(it.modelId)
                }
            }
            f.catalog(row(model = "next"))
            assertEquals(SessionCommandPhase.Observed, f.phase)
        }
    }

    @Test fun `coworkers cannot change or confirm their inherited model`() = runTest {
        fixture { f ->
            f.ready()
            val child = row(model = "next", parentId = "parent")
            // At invocation the UI sees a root, but the authoritative row has changed before send.
            f.socket.binary(f.host.seal(catalog(child))); f.choose(); runCurrent()
            assertEquals("parent", f.task?.parentId)
            assertNull(f.task?.modelId)
            f.choose(); runCurrent()
            assertTrue(f.commands().isEmpty()); assertNull(f.modelAttempt)
            f.catalog(row()); f.choose(); runCurrent(); f.commands()
            for (rows in listOf(child, "${row(model = "next")},$child",
                row(model = "next").dropLast(1) + ",\"parentId\":false}")) {
                f.catalog(rows)
                assertEquals(SessionCommandPhase.Waiting, f.phase)
            }
            f.catalog(row(model = "next")); assertEquals(SessionCommandPhase.Observed, f.phase)
        }
    }

    @Test fun `absent archived duplicate and dirty parent catalog identities cannot authorize a write`() = runTest {
        for (rows in listOf("", row(archived = true), "${row()},${row(parentId = "parent")}",
            "${row()},{\"id\":\"s\"}") + listOf("false", "null", "\"\"", "\" \"", "\"${"p".repeat(513)}\"")
            .map { row().dropLast(1) + ",\"parentId\":$it}" }) fixture { f ->
            f.ready()
            f.socket.binary(f.host.seal(catalog(rows)))
            f.choose(); runCurrent()
            f.choose(); runCurrent()
            assertTrue("ineligible: $rows", f.commands().isEmpty())
            assertNull(f.modelAttempt)
        }
    }

    @Test fun `a slim selected row cannot authorize a model write until a full row arrives`() = runTest {
        fixture { f ->
            f.ready()
            f.catalog("""{"id":"s","title":"Slim","status":"idle"}""")
            f.choose(); runCurrent()
            assertTrue(f.commands().isEmpty()); assertNull(f.modelAttempt)
            f.catalog(row()); f.choose(); runCurrent()
            assertEquals("set-model", f.commands().single()["type"].linkString())
        }
    }

    @Test fun `model selection is one shot while running and only later exact pair is observed`() = runTest {
        fixture { f ->
            f.ready(status = "running")
            val timeline = f.session!!.timeline
            f.choose(); f.choose(model = "other"); runCurrent()
            assertEquals(listOf(json("""{"type":"set-model","sessionId":"s","providerId":"p","modelId":"next"}""")), f.commands())
            assertEquals("old", f.task?.modelId)
            assertEquals(SessionCommandPhase.Waiting, f.phase)
            assertEquals("p", f.modelAttempt?.providerId)
            assertEquals("next", f.modelAttempt?.modelId)
            val id = f.modelAttempt!!.id
            f.catalog(row(model = "next", provider = "other-provider"))
            assertEquals(SessionCommandPhase.Waiting, f.phase)
            f.catalog(row(model = "other"))
            assertEquals(SessionCommandPhase.Waiting, f.phase)
            f.catalog(row(model = "next", id = "other"))
            assertEquals(SessionCommandPhase.Waiting, f.phase)
            f.catalog(row(model = "next"))
            assertEquals(SessionCommandPhase.Observed, f.phase)
            assertEquals(id, f.modelAttempt?.id)
            assertEquals(timeline, f.session!!.timeline)
            assertTrue(f.session!!.running)
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `unknown invalid absent and removed provider pairs never write while current pair is a noop`() = runTest {
        fixture { f ->
            f.ready()
            f.choose(model = "old"); f.choose(provider = "missing"); f.choose(model = "missing")
            f.choose(provider = ""); f.choose(model = " "); f.choose(model = "n".repeat(513))
            runCurrent(); assertTrue(f.commands().isEmpty()); assertNull(f.modelAttempt)
            f.socket.binary(f.host.seal(providers("[]")))
            f.choose(); runCurrent()
            assertTrue(f.commands().isEmpty()); assertNull(f.modelAttempt)
            f.choose(); f.frame(providers()); assertTrue(f.commands().isEmpty())
            f.catalog(row(model = "unknown"))
            f.choose(); runCurrent()
            assertEquals("set-model", f.commands().single()["type"].linkString())
        }
    }

    @Test fun `provider candidates require authenticated metadata and never come from a later duplicate`() = runTest {
        fixture { f ->
            f.link.selectSession("s"); f.begin(); f.prove()
            f.sync(f.commands().single { it["type"].linkString() == "subscribe" })
            f.frame(hostInfo); f.catalog(row())
            assertNull(f.state.providers)
            f.choose(); runCurrent(); assertTrue(f.commands().isEmpty()); assertNull(f.modelAttempt)
            f.frame(providers("""[{"id":"p","name":"First","models":[]},
                {"id":"p","name":"Duplicate","models":[{"id":"next"}]}]"""))
            f.choose(); runCurrent(); assertTrue(f.commands().isEmpty()); assertNull(f.modelAttempt)
            f.frame(providers())
            f.choose(); runCurrent()
            assertEquals("set-model", f.commands().single()["type"].linkString())
        }
    }

    @Test fun `queued model choice captures model baseline and attempt so an older choice cannot revive`() = runTest {
        fixture { f ->
            f.ready()
            f.socket.binary(f.host.seal(catalog(row(model = "other"))))
            f.choose(); runCurrent()
            assertTrue(f.commands().isEmpty()); assertNull(f.modelAttempt)
            f.choose(); runCurrent(); f.commands()
            f.socket.binary(f.host.seal(catalog(row(model = "next"))))
            f.choose(model = "other"); runCurrent()
            assertEquals(SessionCommandPhase.Observed, f.phase)
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `a queued choice cannot revive across a model catalog ABA`() = runTest {
        fixture { f ->
            f.ready()
            f.socket.binary(f.host.seal(catalog(row(model = "other"))))
            f.socket.binary(f.host.seal(catalog(row())))
            f.choose(); runCurrent()
            assertTrue(f.commands().isEmpty()); assertNull(f.modelAttempt)
        }
    }

    @Test fun `stale and invalid catalogs cannot confirm and timeout never retries or accepts a late observation`() = runTest {
        fixture { f ->
            f.ready()
            val stale = f.host.seal(catalog(row(model = "next")))
            f.catalog(row())
            f.choose(); runCurrent(); f.commands()
            f.socket.binary(stale); runCurrent()
            assertEquals("old", f.task?.modelId)
            assertEquals(SessionCommandPhase.Waiting, f.phase)
            f.frame(json("""{"type":"catalog","entries":null}"""))
            assertNull(f.task?.modelId)
            assertEquals(SessionCommandPhase.Waiting, f.phase)
            advanceTimeBy(10_001); runCurrent()
            assertEquals(SessionCommandPhase.Unconfirmed, f.phase)
            f.catalog(row(model = "next"))
            assertEquals("next", f.task?.modelId)
            assertEquals(SessionCommandPhase.Unconfirmed, f.phase)
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `foreground writable synced selection and exact authority generation are required`() = runTest {
        fixture { f ->
            f.ready()
            f.choose(sessionId = "other")
            f.link.setBackgroundAllowed(true); f.link.setVisible(false); f.link.setVisible(true)
            f.choose(); runCurrent()
            assertFalse(f.commands().any { it["type"].linkString() == "set-model" })
            assertNull(f.modelAttempt)
            f.link.setVisible(false); runCurrent(); f.commands()
            f.choose(); runCurrent(); assertTrue(f.commands().isEmpty())
            f.link.setVisible(true); runCurrent(); f.commands()
            f.socket.binary(f.host.seal(json("""{"type":"host-info","readOnly":true}""")))
            f.socket.binary(f.host.seal(hostInfo))
            f.choose(); runCurrent()
            assertTrue(f.commands().isEmpty()); assertNull(f.modelAttempt)
            f.link.selectSession(null); f.link.selectSession("s"); f.choose(); runCurrent()
            assertFalse(f.commands().any { it["type"].linkString() == "set-model" })
            assertNull(f.modelAttempt)
            f.choose(); runCurrent(); assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `unsynced errored and read only sessions cannot choose even with authenticated providers`() = runTest {
        fixture { f ->
            f.link.selectSession("s"); f.begin(); f.prove()
            f.commands(); f.frame(hostInfo); f.frame(providers()); f.catalog(row())
            f.choose(); runCurrent(); assertTrue(f.commands().isEmpty()); assertNull(f.modelAttempt)
            repeat(12) {
                advanceTimeBy(5_001); runCurrent()
                f.socket.text("pong"); runCurrent(); f.commands()
            }
            assertTrue(f.session!!.error)
            f.choose(); runCurrent(); assertTrue(f.commands().isEmpty()); assertNull(f.modelAttempt)
        }
        fixture { f ->
            f.ready(); f.frame(json("""{"type":"host-info","readOnly":true}"""))
            f.choose(); runCurrent(); assertTrue(f.commands().isEmpty()); assertNull(f.modelAttempt)
        }
    }

    @Test fun `same epoch sync can observe but replacement epoch invalidates old model evidence`() = runTest {
        fixture { f ->
            f.ready(); f.choose(); runCurrent(); f.commands()
            f.link.retrySession(); f.choose(model = "other"); runCurrent()
            advanceTimeBy(1_501); runCurrent()
            f.sync(f.commands().single { it["type"].linkString() == "subscribe" })
            assertEquals(SessionCommandPhase.Waiting, f.phase)
            f.catalog(row(model = "next")); assertEquals(SessionCommandPhase.Observed, f.phase)
            f.choose(model = "other"); runCurrent(); f.commands()
            f.link.retrySession(); runCurrent(); advanceTimeBy(1_501); runCurrent()
            val oldEpoch = f.host.seal(catalog(row(model = "other")))
            f.sync(f.commands().single { it["type"].linkString() == "subscribe" }, epoch = "replacement")
            assertEquals(SessionCommandPhase.Unconfirmed, f.phase)
            f.socket.binary(oldEpoch); runCurrent()
            assertEquals(SessionCommandPhase.Unconfirmed, f.phase)
            f.catalog(row(model = "other")); assertEquals(SessionCommandPhase.Unconfirmed, f.phase)
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `an epoch replacement queued ahead of a caller choice cannot replay it after sync`() = runTest {
        fixture { f ->
            f.ready()
            f.socket.binary(f.host.seal(json("""{"type":"agent-event","cursor":{"epoch":"replacement","seq":1},"event":{"type":"status","sessionId":"s","status":"running"}}""")))
            f.choose(); runCurrent(); advanceTimeBy(1_501); runCurrent()
            val commands = f.commands()
            assertFalse(commands.any { it["type"].linkString() == "set-model" })
            f.sync(commands.single { it["type"].linkString() == "subscribe" }, epoch = "replacement")
            assertTrue(f.commands().isEmpty()); assertNull(f.modelAttempt)
        }
    }

    @Test fun `disconnect peer reset and failed send leave an unconfirmed choice without replay`() = runTest {
        fixture { f ->
            f.ready(); f.choose(); runCurrent(); f.commands()
            val old = f.socket
            old.failed(); runCurrent()
            assertEquals(SessionCommandPhase.Unconfirmed, f.phase)
            advanceTimeBy(1_000); runCurrent()
            f.begin(existing = true); f.prove()
            f.sync(f.commands().single { it["type"].linkString() == "subscribe" })
            f.frame(hostInfo); f.frame(providers()); f.catalog(row())
            old.binary(f.host.seal(catalog(row(model = "next")))); runCurrent()
            assertEquals(SessionCommandPhase.Unconfirmed, f.phase)
            assertTrue(f.commands().isEmpty())
            f.socket.accept = false; f.choose(model = "other"); runCurrent()
            assertEquals(LinkPhase.Offline, f.state.phase)
            assertEquals("other", f.modelAttempt?.modelId)
            assertEquals(SessionCommandPhase.Unconfirmed, f.phase)
        }
        fixture { f ->
            f.ready(); f.choose(); runCurrent(); f.commands()
            f.socket.text("""{"type":"host-offline"}"""); f.socket.text("""{"type":"host-online"}""")
            f.choose(model = "other"); runCurrent()
            assertEquals(SessionCommandPhase.Unconfirmed, f.phase)
            assertFalse(f.commands().any { it["type"].linkString() == "set-model" })
        }
    }

    @Test fun `model scope denial is ordered fail closed even after timeout or deselection`() = runTest {
        fixture { f ->
            f.ready(); val staleWritable = f.host.seal(hostInfo)
            f.choose(); runCurrent(); f.commands()
            val oldDenial = f.host.seal(denial)
            // A denial older than the next write must not settle that newer attempt.
            f.catalog(row(model = "next")); f.choose(model = "other"); runCurrent(); f.commands()
            f.socket.binary(oldDenial); runCurrent()
            assertTrue(f.state.readOnly); assertEquals(SessionCommandPhase.Waiting, f.phase)
            f.frame(hostInfo)
            advanceTimeBy(10_001); runCurrent()
            assertEquals(SessionCommandPhase.Unconfirmed, f.phase)
            f.frame(denial); assertEquals(SessionCommandPhase.Rejected, f.phase)
            f.socket.binary(staleWritable); runCurrent(); assertTrue(f.state.readOnly)
            f.catalog(row(model = "other")); assertEquals(SessionCommandPhase.Rejected, f.phase)
            f.link.selectSession(null); runCurrent(); f.commands()
            f.frame(hostInfo); f.frame(denial); assertTrue(f.state.readOnly)
        }
    }

    @Test fun `thinking fields are independent strict optional metadata`() = runTest {
        fixture { f ->
            f.ready()
            assertNull(f.task?.reasoningEnabled); assertNull(f.task?.thinkingLevel)
            for (invalid in listOf("null", "false", "42", "{}", "\"off\"", "\"HIGH\"")) {
                f.catalog(row(reasoning = "false", thinking = invalid))
                assertEquals(false, f.task?.reasoningEnabled); assertNull(f.task?.thinkingLevel)
                assertEquals("old", f.task?.modelId); assertTrue(f.session!!.modelReady)
            }
            for (invalid in listOf("null", "0", "[]", "\"false\"", "\"true\"")) {
                f.catalog(row(reasoning = invalid, thinking = "\"xhigh\""))
                assertNull(f.task?.reasoningEnabled); assertEquals(TaskThinkingLevel.XHigh, f.task?.thinkingLevel)
                assertEquals("p", f.task?.providerId); assertTrue(f.session!!.modelReady)
            }
            f.catalog(row(reasoning = "true", thinking = "\"max\"") + ",{\"id\":\"s\"}")
            assertNull(f.task?.reasoningEnabled); assertNull(f.task?.thinkingLevel)
            assertFalse(f.session!!.modelReady)
        }
    }

    @Test fun `reasoning toggle is one shot and observes only the requested boolean`() = runTest {
        fixture { f ->
            f.ready(); f.catalog(row(reasoning = "true"))
            f.reason(true); runCurrent(); assertTrue(f.commands().isEmpty())
            f.reason(false); f.reason(false); runCurrent()
            assertEquals(listOf(json("""{"type":"set-reasoning","sessionId":"s","enabled":false}""")), f.commands())
            assertEquals(true, f.task?.reasoningEnabled)
            val attempt = f.thinkingAttempt!!
            assertEquals(false, attempt.enabled); assertNull(attempt.level)
            for (rows in listOf(row(), row(reasoning = "\"false\""), row(reasoning = "true", thinking = "\"high\""),
                row(reasoning = "false", parentId = "parent"), row(reasoning = "false", archived = true),
                row(reasoning = "false", id = "other"), row(reasoning = "false") + ",{\"id\":\"s\"}",
                """{"id":"s","title":"Slim","status":"idle","reasoningEnabled":false}""")) {
                f.catalog(rows); assertEquals(SessionCommandPhase.Waiting, f.thinkingPhase)
            }
            f.catalog(row(reasoning = "false", thinking = "\"future-value\""))
            assertEquals(attempt.copy(phase = SessionCommandPhase.Observed), f.thinkingAttempt)
            assertEquals(false, f.task?.reasoningEnabled); assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `thinking level is independent of reasoning and does not require provider candidates`() = runTest {
        fixture { f ->
            f.ready(); f.frame(providers("[]")); f.catalog(row(reasoning = "false", thinking = "\"low\""))
            f.think(TaskThinkingLevel.Low); runCurrent(); assertTrue(f.commands().isEmpty())
            f.think(TaskThinkingLevel.High); runCurrent()
            assertEquals(listOf(json("""{"type":"set-thinking","sessionId":"s","level":"high"}""")), f.commands())
            assertEquals(TaskThinkingLevel.Low, f.task?.thinkingLevel)
            val attempt = f.thinkingAttempt!!
            assertNull(attempt.enabled); assertEquals(TaskThinkingLevel.High, attempt.level)
            f.catalog(row(reasoning = "true", thinking = "\"medium\""))
            assertEquals(SessionCommandPhase.Waiting, f.thinkingPhase)
            f.catalog(row(reasoning = "false", thinking = "\"high\""))
            assertEquals(attempt.copy(phase = SessionCommandPhase.Observed), f.thinkingAttempt)
            assertEquals(TaskThinkingLevel.High, f.task?.thinkingLevel); assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `model and thinking writes are mutually exclusive while waiting`() = runTest {
        fixture { f ->
            f.ready(); f.choose(); f.reason(true); f.think(); runCurrent()
            assertEquals("set-model", f.commands().single()["type"].linkString())
            assertNull(f.thinkingAttempt)
            f.socket.binary(f.host.seal(catalog(row(model = "next"))))
            f.think(); runCurrent()
            assertTrue(f.commands().isEmpty()); assertEquals(SessionCommandPhase.Observed, f.phase)
            f.think(); f.choose(model = "other"); f.reason(true); runCurrent()
            assertEquals("set-thinking", f.commands().single()["type"].linkString())
            assertEquals(SessionCommandPhase.Observed, f.phase)
            f.socket.binary(f.host.seal(catalog(row(model = "next", thinking = "\"high\""))))
            f.choose(model = "other"); f.reason(true); runCurrent()
            assertTrue(f.commands().isEmpty()); assertEquals(SessionCommandPhase.Observed, f.thinkingPhase)
            f.choose(model = "other"); runCurrent()
            assertEquals("set-model", f.commands().single()["type"].linkString())
        }
    }

    @Test fun `model and thinking writes cannot revive across configuration catalog ABA`() = runTest {
        fixture { f ->
            f.ready()
            f.socket.binary(f.host.seal(catalog(row(reasoning = "true", thinking = "\"low\""))))
            f.socket.binary(f.host.seal(catalog(row())))
            f.think(); f.choose(); runCurrent()
            assertTrue(f.commands().isEmpty()); assertNull(f.thinkingAttempt); assertNull(f.modelAttempt)
            f.socket.binary(f.host.seal(catalog(row(model = "other"))))
            f.socket.binary(f.host.seal(catalog(row())))
            f.reason(true); runCurrent()
            assertTrue(f.commands().isEmpty()); assertNull(f.thinkingAttempt)
        }
    }

    @Test fun `thinking writes require foreground authenticated synced writable root authority`() = runTest {
        fixture { f ->
            f.link.selectSession("s"); f.begin()
            val handshakeFrames = f.socket.sent.size
            f.think(); runCurrent(); assertEquals(handshakeFrames, f.socket.sent.size)
            f.prove(); val subscription = f.commands().single { it["type"].linkString() == "subscribe" }
            f.frame(hostInfo); f.catalog(row()); f.think(); runCurrent(); assertTrue(f.commands().isEmpty())
            f.sync(subscription); f.catalog(row()); f.think(sessionId = "other"); runCurrent()
            assertTrue(f.commands().isEmpty())
            f.socket.binary(f.host.seal(catalog(row(parentId = "parent")))); f.think(); runCurrent()
            assertTrue(f.commands().isEmpty()); assertFalse(f.session!!.modelReady)
            f.catalog(row()); f.link.setBackgroundAllowed(true); f.link.setVisible(false); runCurrent(); f.commands()
            f.think(); runCurrent(); assertTrue(f.commands().isEmpty())
            f.link.setVisible(true); runCurrent(); f.commands()
            f.socket.binary(f.host.seal(json("""{"type":"host-info","readOnly":true}""")))
            f.socket.binary(f.host.seal(hostInfo)); f.reason(true); runCurrent()
            assertTrue(f.commands().isEmpty()); assertNull(f.thinkingAttempt)
            f.frame(json("""{"type":"host-info","readOnly":true}""")); f.think(); runCurrent()
            assertTrue(f.commands().isEmpty()); assertNull(f.thinkingAttempt)
        }
    }

    @Test fun `only matching ordered scope denial settles the thinking attempt even after timeout`() = runTest {
        fixture { f ->
            f.ready(); f.think(); runCurrent(); f.commands()
            val stale = f.host.seal(thinkingDenial)
            f.catalog(row(thinking = "\"high\"")); f.think(TaskThinkingLevel.Low); runCurrent(); f.commands()
            f.socket.binary(stale); runCurrent()
            assertTrue(f.state.readOnly); assertEquals(SessionCommandPhase.Waiting, f.thinkingPhase)
            f.frame(hostInfo); f.frame(reasoningDenial)
            assertTrue(f.state.readOnly); assertEquals(SessionCommandPhase.Waiting, f.thinkingPhase)
            f.frame(hostInfo); advanceTimeBy(10_001); runCurrent()
            assertEquals(SessionCommandPhase.Unconfirmed, f.thinkingPhase)
            f.frame(thinkingDenial)
            assertTrue(f.state.readOnly); assertEquals(SessionCommandPhase.Rejected, f.thinkingPhase)
            f.catalog(row(thinking = "\"low\"")); assertEquals(SessionCommandPhase.Rejected, f.thinkingPhase)
            f.link.selectSession(null); runCurrent(); f.commands()
            f.frame(hostInfo); f.frame(thinkingDenial); assertTrue(f.state.readOnly); assertNull(f.thinkingAttempt)
        }
    }

    @Test fun `thinking timeout and disconnect never retry or observe a late catalog`() = runTest {
        fixture { f ->
            f.ready(); val stale = f.host.seal(catalog(row(thinking = "\"high\""))); f.catalog(row())
            f.think(); runCurrent(); f.commands(); f.socket.binary(stale); runCurrent()
            assertEquals(SessionCommandPhase.Waiting, f.thinkingPhase)
            advanceTimeBy(10_001); runCurrent()
            assertEquals(SessionCommandPhase.Unconfirmed, f.thinkingPhase)
            f.catalog(row(thinking = "\"high\"")); assertEquals(SessionCommandPhase.Unconfirmed, f.thinkingPhase)
            assertTrue(f.commands().isEmpty())
            f.reason(true); runCurrent()
            assertEquals(listOf(json("""{"type":"set-reasoning","sessionId":"s","enabled":true}""")), f.commands())
            val old = f.socket
            old.failed(); runCurrent(); assertEquals(SessionCommandPhase.Unconfirmed, f.thinkingPhase)
            advanceTimeBy(1_000); runCurrent(); f.begin(existing = true); f.prove()
            f.sync(f.commands().single { it["type"].linkString() == "subscribe" }); f.frame(hostInfo)
            old.binary(f.host.seal(reasoningDenial)); runCurrent()
            assertFalse(f.state.readOnly)
            f.catalog(row(reasoning = "true")); assertEquals(SessionCommandPhase.Unconfirmed, f.thinkingPhase)
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `a replacement sync epoch invalidates pending thinking evidence`() = runTest {
        fixture { f ->
            f.ready(); f.think(); runCurrent(); f.commands()
            f.link.retrySession(); runCurrent(); advanceTimeBy(1_501); runCurrent()
            f.sync(f.commands().single { it["type"].linkString() == "subscribe" }, epoch = "replacement")
            assertEquals(SessionCommandPhase.Unconfirmed, f.thinkingPhase)
            f.frame(thinkingDenial); f.catalog(row(thinking = "\"high\""))
            assertEquals(SessionCommandPhase.Unconfirmed, f.thinkingPhase); assertTrue(f.commands().isEmpty())
        }
    }

    private fun TestScope.fixture(block: (Fixture) -> Unit) {
        val f = Fixture(this)
        try { block(f) } finally { f.link.close(); runCurrent(); advanceTimeBy(1_001); runCurrent() }
    }

    private class Fixture(val scope: TestScope) {
        val key = ByteArray(32)
        val host = FrameReplay(key, ReplayRole.Host, announce = true)
        val sockets = mutableListOf<FakeSocket>()
        val socket get() = sockets.last()
        val link = DesktopLink(PairCredentials("pair-1", "token", key, "Eaves", "https://example.test"),
            {}, false, StandardTestDispatcher(scope.testScheduler), { scope.testScheduler.currentTime }, { 0.5 },
            { request, listener -> FakeSocket(request, listener).also(sockets::add) })
        val state get() = link.state.value
        val session get() = state.session
        val task get() = state.catalog.find { it.id == "s" }
        val modelAttempt get() = session?.modelAttempt
        val phase get() = modelAttempt?.phase
        val thinkingAttempt get() = session?.thinkingAttempt
        val thinkingPhase get() = thinkingAttempt?.phase
        fun choose(sessionId: String = "s", provider: String = "p", model: String = "next") =
            link.setModel(sessionId, provider, model)
        fun reason(enabled: Boolean) = link.setReasoning("s", enabled)
        fun think(level: TaskThinkingLevel = TaskThinkingLevel.High, sessionId: String = "s") =
            link.setThinking(sessionId, level)
        fun begin(existing: Boolean = false) {
            if (!existing) link.setVisible(true)
            scope.runCurrent()
            socket.opened(); socket.text("pong"); socket.text("""{"type":"host-online"}""")
            scope.runCurrent(); host.peerReset()
        }
        fun prove() {
            socket.sent.forEach { host.open(it) }; socket.sent.clear()
            frame(json("""{"type":"replay-hello"}"""))
            assertEquals(LinkPhase.Online, state.phase)
        }
        fun ready(status: String = "idle") {
            link.selectSession("s"); begin(); prove()
            sync(commands().single { it["type"].linkString() == "subscribe" }, status = status)
            frame(hostInfo); frame(providers()); catalog(row())
        }
        fun frame(frame: JsonObject) { socket.binary(host.seal(frame)); scope.runCurrent() }
        fun catalog(rows: String) = frame(DesktopModelTest.catalog(rows))
        fun sync(command: JsonObject, epoch: String = "e", status: String = "idle") {
            val requestId = (command["sync"] as JsonObject)["requestId"].linkString()
            frame(json("""{"type":"session-sync","sessionId":"s","requestId":"$requestId","cursor":{"epoch":"$epoch","seq":0},"mode":"snapshot","snapshot":{"type":"snapshot","sessions":[{"sessionId":"s","identity":{"sessionId":"s","generation":"g"},"baseIndex":0,"messages":[],"status":"$status"}]}}"""))
        }
        fun commands(): List<JsonObject> = socket.sent.mapNotNull { host.open(it)?.payload }.also { socket.sent.clear() }
    }

    private class FakeSocket(private val request: Request, private val listener: WebSocketListener) : WebSocket {
        val sent = mutableListOf<ByteArray>()
        var accept = true
        override fun request() = request
        override fun queueSize() = 0L
        override fun send(text: String) = accept
        override fun send(bytes: ByteString): Boolean {
            if (!accept) return false
            sent.add(bytes.toByteArray()); return true
        }
        override fun close(code: Int, reason: String?) = false
        override fun cancel() = Unit
        fun opened() = listener.onOpen(this, Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(101).message("Upgrade").build())
        fun text(value: String) = listener.onMessage(this, value)
        fun binary(value: ByteArray) = listener.onMessage(this, value.toByteString())
        fun failed() = listener.onFailure(this, IOException(), null)
    }

    private companion object {
        val hostInfo = json("""{"type":"host-info","hostname":"Host"}""")
        val denial = json("""{"type":"command-rejected","command":"set-model","error":"read-only"}""")
        val thinkingDenial = json("""{"type":"command-rejected","command":"set-thinking","error":"read-only"}""")
        val reasoningDenial = json("""{"type":"command-rejected","command":"set-reasoning","error":"read-only"}""")
        fun json(value: String) = Json.parseToJsonElement(value) as JsonObject
        fun providers(rows: String = """[{"id":"p","name":"Provider","models":[{"id":"old"},{"id":"next"},{"id":"other"}]}]""") =
            json("""{"type":"providers","providers":$rows}""")
        fun row(model: String = "old", provider: String = "p", id: String = "s", archived: Boolean = false,
                parentId: String? = null, reasoning: String? = null, thinking: String? = null) =
            """{"id":"$id","title":"Task","projectName":"P","status":"idle","archived":$archived,"providerId":"$provider","modelId":"$model"${parentId?.let { ",\"parentId\":\"$it\"" } ?: ""}${reasoning?.let { ",\"reasoningEnabled\":$it" } ?: ""}${thinking?.let { ",\"thinkingLevel\":$it" } ?: ""}}"""
        fun catalog(rows: String) = json("""{"type":"catalog","entries":[$rows]}""")
    }
}
