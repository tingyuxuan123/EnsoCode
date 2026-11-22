package io.github.tingyuxuan123.codekiln.ui

import io.github.tingyuxuan123.codekiln.mirror.DesktopFileChunk
import io.github.tingyuxuan123.codekiln.mirror.DesktopFileEntry
import io.github.tingyuxuan123.codekiln.mirror.DesktopPreviewEntry
import io.github.tingyuxuan123.codekiln.mirror.FILE_CHUNK_BYTES
import io.github.tingyuxuan123.codekiln.mirror.SessionImageTarget
import java.io.OutputStream
import java.net.InetAddress
import java.net.URI
import java.util.Locale
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

internal sealed interface SessionLink {
    data class Browser(val url: String) : SessionLink
    data class Preview(val label: String, val kind: String, val absolute: Boolean = false) : SessionLink {
        fun match(entries: List<DesktopPreviewEntry>): DesktopPreviewEntry? =
            bestPathMatch(label, absolute, entries.filter { it.kind == kind }, DesktopPreviewEntry::label)
    }
    data class File(val path: String, val absolute: Boolean = false) : SessionLink {
        fun match(entries: List<DesktopFileEntry>): DesktopFileEntry? =
            bestPathMatch(path, absolute, entries, DesktopFileEntry::rel) ?: entries.singleOrNull {
                !absolute && '/' !in path && it.name == path
            }
    }
}

// A desktop absolute pathname is only a label. Match the most specific listed relative name;
// ambiguous or unlisted references are not actionable and no filesystem path is returned on wire.
private fun <T> bestPathMatch(path: String, absolute: Boolean, entries: List<T>, relative: (T) -> String): T? {
    val matches = entries.mapNotNull { entry ->
        val name = relative(entry).replace('\\', '/')
        if (path == name || absolute && path.endsWith("/$name")) entry to name.length else null
    }
    val best = matches.maxOfOrNull { it.second } ?: return null
    return matches.singleOrNull { it.second == best }?.first
}

// Mirrors the desktop preview's literal origins, never the browser's permissive numeric URL parsing.
private val localHosts = setOf("localhost", "127.0.0.1", "[::1]", "0.0.0.0")
private val numericHost = Regex("(?i)(?:[0-9]+|0x[0-9a-f]+)(?:\\.(?:[0-9]+|0x[0-9a-f]+))*\\.?")
private fun parsedUri(raw: String) = runCatching { URI(raw) }.getOrNull()

internal fun sessionLink(raw: String): SessionLink? {
    if (raw.isBlank() || raw.length > 4096 || '\\' in raw) return null
    val uri = parsedUri(raw) ?: return null
    if (uri.scheme == null || uri.scheme.equals("file", true)) {
        if (uri.rawAuthority != null || uri.rawQuery != null || uri.rawFragment != null) return null
        val path = uri.path ?: return null
        val absolute = path.startsWith('/')
        if (uri.scheme != null && !absolute) return null
        val rel = artifactPath(path.removePrefix("/").replaceFirst(windowsDrive, "")) ?: return null
        return if (rel.endsWith(".html", true) || rel.endsWith(".htm", true)) SessionLink.Preview(rel, "html", absolute)
        else SessionLink.File(rel, absolute)
    }
    val web = sessionWebUrl(raw) ?: return null
    val host = uri.host.lowercase(Locale.ROOT).removeSuffix(".")
    if (host !in localHosts) {
        if (numericHost.matches(host) && (!host.matches(Regex("(?:[0-9]{1,3}\\.){3}[0-9]{1,3}")) ||
            host.startsWith("127.") || host.startsWith("0.") || host.split('.').any { it.length > 1 && it.startsWith('0') })) return null
        // Bracketed addresses are literals; do not send alternate spellings of loopback to Android.
        if (host.startsWith('[')) {
            val literal = runCatching { InetAddress.getByName(host) }.getOrNull() ?: return null
            if (literal.isLoopbackAddress || literal.isAnyLocalAddress) return null
        }
        return SessionLink.Browser(web)
    }
    if (uri.scheme != "http" || uri.port !in 1024..65535 || uri.rawQuery != null || uri.rawFragment != null) return null
    val path = uri.path.orEmpty()
    if (path.any { it <= ' ' || it == '\u007f' || it in "\\?#%" } ||
        path.split('/').any { it == "." || it == ".." }) return null
    return SessionLink.Preview("http://127.0.0.1:${uri.port}${uri.rawPath.ifEmpty { "/" }}", "server")
}

private val windowsDrive = Regex("^[A-Za-z]:/")

internal fun artifactPath(path: String): String? = path.removePrefix("./").takeIf { rel ->
    rel.length in 1..4096 && rel.none { it.isISOControl() || it in "\\:%" } &&
        rel.split('/').none { it.isBlank() || it == "." || it == ".." }
}

private val pathHints = Regex("""`([^`\r\n]+)`|\]\(<?([^\s)<>]+)>?\)|<([^<>\r\n]+)>|([^\s\p{Ps}\p{Pe}<>`'"，。；！？]+)""")

/** A mention can select an existing listing row, never authorise a fresh path. */
internal fun replyArtifacts(turn: SessionTurn, entries: List<DesktopFileEntry>): List<DesktopFileEntry> {
    if (turn.user || entries.isEmpty()) return emptyList()
    val hints = turn.blocks.asSequence().filterIsInstance<SessionBlock.Prose>().flatMap { prose ->
        pathHints.findAll(prose.text).mapNotNull { match -> match.groups.drop(1).firstNotNullOfOrNull { it?.value } }
    }.take(2048).mapNotNull { hint ->
        val token = hint.trimEnd('.', ',', ';', '!', '。', '，', '；', '！')
        when (val link = sessionLink(token)) {
            is SessionLink.File -> link
            is SessionLink.Preview -> if (link.kind == "html") SessionLink.File(link.label, link.absolute) else null
            else -> if (parsedUri(token) == null && !token.startsWith("//")) artifactPath(token)?.let { SessionLink.File(it) } else null
        }
    }.filter { '.' in it.path.substringAfterLast('/') }.toSet() + turn.artifactHints.map { SessionLink.File(it) }
    val matches = hints.mapNotNull { it.match(entries) }.toSet()
    return entries.filter { it in matches }.take(8)
}

private val generatedId = Regex("[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}")
private val imageExtensions = mapOf("image/png" to "png", "image/jpeg" to "jpg", "image/webp" to "webp", "image/gif" to "gif")

internal fun generatedImageTarget(text: String): SessionImageTarget.Generated? {
    if (text.length !in 1..4096) return null
    val result = runCatching { Json.parseToJsonElement(text) as? JsonObject }.getOrNull() ?: return null
    if (result["ok"] != JsonPrimitive(true)) return null
    val image = result["image"] as? JsonObject ?: return null
    val id = (image["id"] as? JsonPrimitive)?.content?.takeIf(generatedId::matches) ?: return null
    val format = imageExtensions[(image["mimeType"] as? JsonPrimitive)?.content] ?: return null
    val rel = ".xiaoman/images/$id.$format"
    return SessionImageTarget.Generated(rel).takeIf { image["path"] == JsonPrimitive(rel) }
}

internal const val ARTIFACT_MAX_BYTES = 50L * 1024 * 1024 // Existing Pair download limit.

/** An incomplete download is never passed to Android's opener or document provider. */
internal suspend fun copyArtifact(entry: DesktopFileEntry, out: OutputStream,
    read: suspend (Long) -> DesktopFileChunk?, onProgress: (Long) -> Unit = {}): Boolean {
    if (entry.size !in 0..ARTIFACT_MAX_BYTES) return false
    var offset = 0L
    do {
        currentCoroutineContext().ensureActive()
        val chunk = read(offset) ?: return false
        currentCoroutineContext().ensureActive()
        if (chunk.error != null || chunk.fileId != entry.id || chunk.size != entry.size || chunk.offset != offset ||
            chunk.data.size > FILE_CHUNK_BYTES || chunk.data.size > entry.size - offset ||
            chunk.data.isEmpty() && offset < entry.size) return false
        out.write(chunk.data)
        offset += chunk.data.size
        onProgress(offset)
    } while (offset < entry.size)
    return true
}
