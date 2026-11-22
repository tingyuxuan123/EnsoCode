package io.github.tingyuxuan123.codekiln.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.platform.LocalContext
import io.github.tingyuxuan123.codekiln.mirror.DesktopFileEntry
import io.github.tingyuxuan123.codekiln.mirror.FileDownloadTarget
import java.io.File
import java.nio.file.Files
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

internal data class ArtifactDownloadKey(val target: FileDownloadTarget, val fileId: String)

internal sealed interface ArtifactTransfer {
    data class Downloading(val bytes: Long, val size: Long) : ArtifactTransfer
    class Ready(val file: File) : ArtifactTransfer { var granted = false }
    data object Failed : ArtifactTransfer
    data object Cancelled : ArtifactTransfer
}

internal fun ArtifactTransfer?.isAvailableOrDownloading(): Boolean =
    this is ArtifactTransfer.Downloading || this is ArtifactTransfer.Ready && file.isFile

internal fun ArtifactTransfer?.cardLabel(): String? = when (this) {
    is ArtifactTransfer.Downloading -> "正在下载 · ${if (size <= 0L) 0 else (100 * bytes / size).coerceIn(0, 99)}%"
    is ArtifactTransfer.Ready -> if (file.isFile) "已下载" else null
    ArtifactTransfer.Failed -> "下载中断 · 可重试"
    ArtifactTransfer.Cancelled -> "已取消"
    null -> null
}

/**
 * Owned by the paired app, not by a sheet. Only one transfer at a time (as on the host).
 * Calls and state changes are confined to the owner's dispatcher; disk I/O runs separately.
 * Every read still goes through the original connection/target/opaque-ID authorization.
 */
internal class ArtifactDownloads(
    private val root: File,
    private val scope: CoroutineScope,
    private val io: CoroutineDispatcher = Dispatchers.IO,
) : AutoCloseable {
    private class Active(val key: ArtifactDownloadKey) { var job: Job? = null }
    private val changes = MutableStateFlow<Map<ArtifactDownloadKey, ArtifactTransfer>>(emptyMap())
    val state = changes.asStateFlow()
    private var active: Active? = null
    private var closed = false

    fun start(key: ArtifactDownloadKey, entry: DesktopFileEntry, read: ArtifactChunkReader): Boolean {
        if (closed || key.fileId != entry.id || entry.size !in 0L..ARTIFACT_MAX_BYTES) return false
        if ((state.value[key] as? ArtifactTransfer.Ready)?.file?.isFile == true || active?.key == key) return true
        if (active != null) return false
        val task = Active(key)
        active = task
        publish(key, ArtifactTransfer.Downloading(0, entry.size))
        val owner = scope.coroutineContext.minusKey(Job)
        task.job = scope.launch(start = CoroutineStart.UNDISPATCHED) {
            var staged: File? = null
            var result: ArtifactTransfer = ArtifactTransfer.Failed
            try {
                val complete = withContext(io) {
                    val local = stage(entry).also { staged = it }
                    local.outputStream().use { out ->
                        copyArtifact(entry, out, { offset ->
                            withContext(owner) {
                                if (offset != 0L && !closed) publish(key, ArtifactTransfer.Downloading(offset, entry.size))
                                read(entry.id, offset)
                            }
                        })
                    }
                }
                if (complete && !closed) {
                    result = ArtifactTransfer.Ready(checkNotNull(staged))
                    staged = null
                }
            } catch (cancelled: CancellationException) {
                result = ArtifactTransfer.Cancelled
                throw cancelled
            } catch (_: Exception) {
                // Never expose raw desktop payloads or paths in an error.
            } finally {
                staged?.let { withContext(NonCancellable) { withContext(io) { removeStaged(it) } } }
                if (active === task) {
                    active = null
                    if (!closed) publish(key, result)
                }
            }
        }
        return true
    }

    fun cancel(key: ArtifactDownloadKey) {
        active?.takeIf { it.key == key }?.job?.cancel()
    }

    override fun close() {
        closed = true
        active?.job?.cancel()
        changes.value.values.filterIsInstance<ArtifactTransfer.Ready>().forEach(::release)
        changes.value = emptyMap()
    }

    private fun stage(entry: DesktopFileEntry): File {
        Files.createDirectories(root.toPath())
        val cutoff = System.currentTimeMillis() - 24 * 60 * 60 * 1000L
        root.listFiles()?.filter { it.name.startsWith("item-") && it.lastModified() < cutoff }?.forEach { it.deleteRecursively() }
        return File(Files.createTempDirectory(root.toPath(), "item-").toFile(), localFileName(entry.name))
    }

    private fun publish(key: ArtifactDownloadKey, value: ArtifactTransfer) {
        val next = LinkedHashMap(changes.value)
        val old = next.remove(key)
        if (old is ArtifactTransfer.Ready && old !== value) release(old)
        next[key] = value
        // Keep completed and failed entries bounded. Granted files expire under the cache's TTL.
        next.filterValues { it is ArtifactTransfer.Ready }.keys.toList().dropLast(4).forEach {
            (next.remove(it) as? ArtifactTransfer.Ready)?.let(::release)
        }
        while (next.size > 16) {
            val oldest = next.keys.firstOrNull { next[it] !is ArtifactTransfer.Downloading } ?: break
            (next.remove(oldest) as? ArtifactTransfer.Ready)?.let(::release)
        }
        changes.value = next
    }

    private fun release(ready: ArtifactTransfer.Ready) {
        if (!ready.granted) removeStaged(ready.file)
    }

    private fun removeStaged(file: File) {
        runCatching { file.parentFile?.deleteRecursively() }
    }
}

internal val LocalArtifactDownloads = staticCompositionLocalOf<ArtifactDownloads?> { null }

@Composable
internal fun downloadEntryTransfer(downloads: ArtifactDownloads?, target: FileDownloadTarget, fileId: String?): ArtifactTransfer? {
    if (downloads == null || fileId == null) return null
    return downloads.state.collectAsState().value[ArtifactDownloadKey(target, fileId)]
}

@Composable
internal fun rememberArtifactDownloads(identity: Any?): ArtifactDownloads {
    val context = LocalContext.current.applicationContext
    val scope = rememberCoroutineScope()
    val store = remember(identity, scope, context) { ArtifactDownloads(File(context.cacheDir, "downloaded-artifacts"), scope) }
    DisposableEffect(store) { onDispose(store::close) }
    return store
}
