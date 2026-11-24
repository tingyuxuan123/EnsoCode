package io.github.tingyuxuan123.codekiln.mirror

/** Read uses the successful tool call's identity, never its desktop filesystem path. */
sealed interface SessionImageTarget {
    data class Read(val toolCallId: String) : SessionImageTarget
    data class Generated(val relativePath: String) : SessionImageTarget
}

private val imageId = Regex("[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}")
private val generatedPath = Regex("\\.xiaoman/images/${imageId.pattern}\\.(png|jpg|webp|gif)")

internal fun SessionImageTarget.isValid(): Boolean = when (this) {
    is SessionImageTarget.Read -> toolCallId.length in 1..512 && toolCallId.isNotBlank() && toolCallId.none(Char::isISOControl)
    is SessionImageTarget.Generated -> generatedPath.matches(relativePath)
}

sealed interface FileDownloadTarget {
    data class Session(val id: String) : FileDownloadTarget
}
