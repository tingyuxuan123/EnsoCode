package io.github.tingyuxuan123.eaves.ui

import io.github.tingyuxuan123.eaves.mirror.SessionImage
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class SessionPictureDraftTest {
    private fun picture(id: String) = LocalSessionPicture(id, SessionImage("test-$id"), byteArrayOf(), jpegBytes = 100)

    @Test fun `late picker result cannot attach to another session`() = runTest {
        val model = SessionPictureDraft(backgroundScope) { _, _ -> listOf(picture("new")) }
        model.bind("first")
        val ticket = model.ticket()
        assertNotNull(ticket)
        model.bind("second")
        model.select(ticket, listOf("content://fixture/old"))
        runCurrent()
        assertEquals("second", model.state.value.owner)
        assertTrue(model.state.value.pictures.isEmpty())
    }

    @Test fun `failed addition and canceled selection keep existing encoded draft`() = runTest {
        var fail = false
        val model = SessionPictureDraft(backgroundScope) { _, _ ->
            if (fail) throw PictureImportException("读取失败")
            listOf(picture("initial"))
        }
        model.bind("s")
        model.select(model.ticket(), listOf("content://fixture/first")); runCurrent()
        assertEquals("initial", model.state.value.pictures.single().id)
        fail = true
        model.select(model.ticket(), listOf("content://fixture/second")); runCurrent()
        assertEquals("initial", model.state.value.pictures.single().id)
        assertEquals("读取失败", model.state.value.error)
        model.select(model.ticket(), emptyList()); runCurrent()
        assertEquals("initial", model.state.value.pictures.single().id)
    }

    @Test fun `in flight import is canceled and never restores an unpaired draft`() = runTest {
        val gate = CompletableDeferred<List<LocalSessionPicture>>()
        val model = SessionPictureDraft(backgroundScope) { _, _ -> gate.await() }
        model.bind("s"); model.select(model.ticket(), listOf("content://fixture/first")); runCurrent()
        assertTrue(model.state.value.loading)
        model.bind(null)
        gate.complete(listOf(picture("old"))); runCurrent()
        assertNull(model.state.value.owner)
        assertTrue(model.state.value.pictures.isEmpty())
        assertFalse(model.state.value.loading)
    }

    @Test fun `only matching authority clears the submitted pictures not a replacement with identical bytes`() = runTest {
        var serial = 0
        val model = SessionPictureDraft(backgroundScope) { _, _ -> listOf(picture("${++serial}")) }
        model.bind("s"); model.select(model.ticket(), listOf("content://fixture/one")); runCurrent()
        val before = model.state.value.pictures.single().image.fingerprint
        model.sent("caption")
        assertNull(model.observed("s", "caption", listOf("wrong")))
        assertEquals(1, model.state.value.pictures.size)
        assertEquals("caption", model.observed("s", "caption", listOf(before)))
        assertTrue(model.state.value.pictures.isEmpty())
        model.select(model.ticket(), listOf("content://fixture/two")); runCurrent()
        val next = model.state.value.pictures.single().image.fingerprint
        model.sent("next")
        model.remove("2")
        model.select(model.ticket(), listOf("content://fixture/three")); runCurrent()
        assertNull(model.observed("s", "next", listOf(next)))
        assertEquals("3", model.state.value.pictures.single().id)
    }
}
