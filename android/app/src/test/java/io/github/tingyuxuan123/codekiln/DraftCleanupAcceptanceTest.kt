package io.github.tingyuxuan123.codekiln

import io.github.tingyuxuan123.codekiln.mirror.DesktopLinkState
import io.github.tingyuxuan123.codekiln.mirror.DraftKey
import io.github.tingyuxuan123.codekiln.mirror.DraftKind
import io.github.tingyuxuan123.codekiln.mirror.LinkPhase
import io.github.tingyuxuan123.codekiln.mirror.PairCredentialStore
import io.github.tingyuxuan123.codekiln.mirror.PairCredentials
import io.github.tingyuxuan123.codekiln.mirror.TextDraftStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class DraftCleanupAcceptanceTest {
    private val key = DraftKey(DraftKind.Session, "session-a")
    private class Drafts : TextDraftStore {
        var entries = emptyMap<DraftKey, String>()
        override fun load(pairId: String) = entries
        override fun save(pairId: String, entries: Map<DraftKey, String>) { this.entries = entries }
        override fun clear(pairId: String?) { entries = emptyMap() }
    }
    private class Credentials : PairCredentialStore {
        var saved: PairCredentials? = PairCredentials("pair-a", "fixture-token", ByteArray(32) { 7 },
            "Test phone", "https://relay.example.test", 1)
        var duringClear: (() -> Unit)? = null
        override fun load() = saved
        override fun save(credentials: PairCredentials) { saved = credentials }
        override fun pin(credentials: PairCredentials) = Unit
        override fun clear(expectedPairId: String?) { duringClear?.invoke(); saved = null }
    }
    private class Link : CompanionLink {
        override val state = MutableStateFlow(DesktopLinkState(phase = LinkPhase.Online))
        override fun setVisible(visible: Boolean) = Unit
        override fun reconnect() = Unit
        override fun close() = Unit
    }

    @Test fun `onStop flush during credential deletion cannot revive drafts after successful unpair`() = runTest {
        val disk = Drafts()
        val credentials = Credentials()
        val link = Link()
        val dispatcher = StandardTestDispatcher(testScheduler)
        val book = DraftBook(disk, backgroundScope, dispatcher)
        book.bind("pair-a")
        val controller = CompanionController(credentials, { error("No claim expected") }, {}, { _, _ -> link },
            backgroundScope, dispatcher, drafts = disk)
        runCurrent()
        book.edit(key, "unsent private draft")
        // Credentials are cleared on IO after drafts.clear(), while pairId/paired still bind the UI book.
        // A real Activity.onStop can flush in exactly this outstanding-IO window.
        credentials.duringClear = { book.flush() }
        controller.unpair()
        runCurrent()
        assertFalse(controller.state.value.paired)
        book.bind(null)
        assertEquals("A successful unpair must leave no resurrected draft on disk", emptyMap<DraftKey, String>(), disk.entries)
    }

    @Test fun `authorization replaced removes drafts as documented without sending or reconnecting`() = runTest {
        val disk = Drafts().apply { entries = mapOf(key to "private draft") }
        val credentials = Credentials()
        val link = Link()
        val controller = CompanionController(credentials, { error("No claim expected") }, {}, { _, _ -> link },
            backgroundScope, StandardTestDispatcher(testScheduler), drafts = disk)
        runCurrent()
        link.state.value = DesktopLinkState(phase = LinkPhase.Replaced)
        runCurrent()
        assertEquals(LinkPhase.Replaced, controller.state.value.link.phase)
        assertEquals("README promises removal when authorization is replaced", emptyMap<DraftKey, String>(), disk.entries)
    }
}
