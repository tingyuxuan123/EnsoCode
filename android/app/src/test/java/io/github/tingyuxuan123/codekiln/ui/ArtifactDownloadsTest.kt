package io.github.tingyuxuan123.codekiln.ui

import io.github.tingyuxuan123.codekiln.mirror.DesktopFileChunk
import io.github.tingyuxuan123.codekiln.mirror.DesktopFileEntry
import io.github.tingyuxuan123.codekiln.mirror.FileDownloadTarget
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

@OptIn(ExperimentalCoroutinesApi::class)
class ArtifactDownloadsTest {
    @get:Rule val folder = TemporaryFolder()
    private val target = FileDownloadTarget.Session("s")
    private val file = DesktopFileEntry("verified-id", "report.pdf", 4, "out/report.pdf")
    private val key = ArtifactDownloadKey(target, file.id)

    @Test fun `duplicate starts join the active transfer and reuse the complete cached file`() = runTest {
        val downloads = ArtifactDownloads(folder.root, this, StandardTestDispatcher(testScheduler))
        val release = CompletableDeferred<Unit>()
        val requests = mutableListOf<Long>()
        try {
            assertTrue(downloads.start(key, file) { _, offset ->
                requests += offset
                if (offset != 0L) release.await()
                DesktopFileChunk(file.id, file.name, file.size, offset,
                    if (offset == 0L) byteArrayOf(1, 2) else byteArrayOf(3, 4))
            })
            runCurrent()
            assertEquals(ArtifactTransfer.Downloading(2, 4), downloads.state.value[key])
            assertTrue(downloads.start(key, file) { _, _ -> error("reopened a panel, must not read from desktop again") })
            release.complete(Unit)
            runCurrent()
            val ready = downloads.state.value[key] as ArtifactTransfer.Ready
            assertArrayEquals(byteArrayOf(1, 2, 3, 4), ready.file.readBytes())
            assertTrue(downloads.start(key, file) { _, _ -> error("already cached") })
            assertEquals(listOf(0L, 2L), requests)
            assertFalse(downloads.state.value.containsKey(ArtifactDownloadKey(FileDownloadTarget.Session("other"), file.id)))
        } finally { downloads.close() }
        assertTrue(folder.root.listFiles().orEmpty().isEmpty())
    }

    @Test fun `cancellation and a failed read never leave a usable or partial file`() = runTest {
        val downloads = ArtifactDownloads(folder.root, this, StandardTestDispatcher(testScheduler))
        try {
            val never = CompletableDeferred<DesktopFileChunk?>()
            assertTrue(downloads.start(key, file) { _, _ -> never.await() })
            runCurrent()
            downloads.cancel(key)
            runCurrent()
            assertEquals(ArtifactTransfer.Cancelled, downloads.state.value[key])
            assertTrue(folder.root.listFiles().orEmpty().isEmpty())

            assertTrue(downloads.start(key, file) { _, offset ->
                if (offset == 0L) DesktopFileChunk(file.id, file.name, 4, offset, byteArrayOf(1)) else null
            })
            runCurrent()
            assertEquals(ArtifactTransfer.Failed, downloads.state.value[key])
            assertTrue(folder.root.listFiles().orEmpty().isEmpty())
        } finally { downloads.close() }
    }
}
