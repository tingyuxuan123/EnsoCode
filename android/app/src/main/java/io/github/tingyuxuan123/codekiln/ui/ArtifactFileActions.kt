package io.github.tingyuxuan123.codekiln.ui

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import io.github.tingyuxuan123.codekiln.mirror.DesktopFileChunk
import io.github.tingyuxuan123.codekiln.mirror.DesktopFileEntry
import io.github.tingyuxuan123.codekiln.mirror.FileDownloadTarget
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

internal typealias ArtifactChunkReader = suspend (String, Long) -> DesktopFileChunk?
internal typealias ArtifactFetcher = suspend (FileDownloadTarget, String, Long) -> DesktopFileChunk?

// Do not delegate executable, shortcut or web artifacts to an external activity as a document.
internal fun artifactExternalMime(name: String): String? = when (name.substringAfterLast('.', "").lowercase()) {
    "pdf" -> "application/pdf"
    "doc" -> "application/msword"
    "docx" -> "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    "xls" -> "application/vnd.ms-excel"
    "xlsx" -> "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    "ppt" -> "application/vnd.ms-powerpoint"
    "pptx" -> "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    "txt", "md", "log" -> "text/plain"
    "csv" -> "text/csv"
    "png" -> "image/png"
    "jpg", "jpeg" -> "image/jpeg"
    "webp" -> "image/webp"
    "gif" -> "image/gif"
    else -> null
}

internal enum class ArtifactAction { Open, Save }

private fun isApk(name: String) = name.endsWith(".apk", ignoreCase = true)

/** APKs are downloadable only. Never hand them to a package installer. */
internal fun artifactActionOnTap(name: String): ArtifactAction? = when {
    isApk(name) -> ArtifactAction.Save
    artifactExternalMime(name)?.startsWith("application/") == true -> ArtifactAction.Open
    else -> null
}

internal fun artifactSaveMime(name: String): String = if (isApk(name)) "application/vnd.android.package-archive"
    else artifactExternalMime(name) ?: "application/octet-stream"

internal fun localFileName(name: String): String {
    val clean = name.map { if (it.isISOControl() || it in "/\\:") '_' else it }.joinToString("")
        .trim().trim('.').ifEmpty { "artifact" }
    return if (clean.toByteArray().size <= 200) clean else
        clean.substringBeforeLast('.').take(60) + clean.substringAfterLast('.', "").takeIf { it.length in 1..12 }?.let { ".$it" }.orEmpty()
}

@Composable
internal fun ArtifactFileActions(entry: DesktopFileEntry, target: FileDownloadTarget, downloads: ArtifactDownloads,
    read: ArtifactChunkReader, canStart: Boolean,
    autoAction: ArtifactAction? = null, onAutoAction: () -> Unit = {}) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val mime = artifactExternalMime(entry.name)
    val key = ArtifactDownloadKey(target, entry.id)
    val transfers by downloads.state.collectAsState()
    val transfer = transfers[key]
    val downloaded = (transfer as? ArtifactTransfer.Ready)?.file?.isFile == true
    var followUp by remember(key) { mutableStateOf<ArtifactAction?>(null) }
    var saveJob by remember(key) { mutableStateOf<Job?>(null) }
    var pickerFile by remember(key) { mutableStateOf<ArtifactTransfer.Ready?>(null) }
    var notice by remember(key) { mutableStateOf<String?>(null) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val file = pickerFile?.file
        pickerFile = null
        val uri = result.data?.data
        if (result.resultCode == Activity.RESULT_OK && uri != null && file != null) {
            saveJob = scope.launch {
                try {
                    withContext(Dispatchers.IO) {
                        context.contentResolver.openOutputStream(uri, "wt")?.use { out ->
                            file.inputStream().use { it.copyTo(out) }
                        } ?: error("No output stream")
                    }
                    notice = "已保存 ${entry.name}"
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (_: Exception) {
                    notice = "保存失败，请换一个位置重试。"
                } finally { saveJob = null }
            }
        }
    }

    fun deliver(file: ArtifactTransfer.Ready, action: ArtifactAction) {
        if (action == ArtifactAction.Save) {
            pickerFile = file
            try {
                picker.launch(Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                    .setType(artifactSaveMime(entry.name)).putExtra(Intent.EXTRA_TITLE, localFileName(entry.name)))
            } catch (_: ActivityNotFoundException) {
                pickerFile = null
                notice = "此设备没有可保存文件的应用。"
            }
            return
        }
        if (mime == null) return
        try {
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.artifacts", file.file)
            context.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
            file.granted = true
        } catch (_: ActivityNotFoundException) {
            notice = "手机没有可打开此文件的应用，可以先保存。"
        } catch (_: SecurityException) {
            notice = "系统未允许打开此文件，可以先保存。"
        }
    }

    fun request(action: ArtifactAction, automatic: Boolean = false) {
        if (saveJob != null || pickerFile != null) return
        notice = null
        val current = downloads.state.value[key]
        // Opening the panel again shows the existing task/file. It never starts a second transfer
        // or launches a system dialog just because the user looked at its progress.
        if (current is ArtifactTransfer.Ready && current.file.isFile) {
            if (!automatic) deliver(current, action)
            return
        }
        if (current is ArtifactTransfer.Downloading) return
        if (!canStart || entry.size !in 0..ARTIFACT_MAX_BYTES) return
        if (downloads.start(key, entry, read)) followUp = action
        else notice = "另一个文件正在下载，完成后再试。"
    }

    LaunchedEffect(autoAction, canStart, key) {
        if (autoAction != null && (canStart || transfer is ArtifactTransfer.Downloading || downloaded)) {
            onAutoAction()
            request(autoAction, automatic = true)
        }
    }
    LaunchedEffect(followUp, key) {
        val action = followUp ?: return@LaunchedEffect
        val finished = downloads.state.map { it[key] }.first { it !is ArtifactTransfer.Downloading }
        followUp = null
        if (finished is ArtifactTransfer.Ready && finished.file.isFile) deliver(finished, action)
    }
    val ready = transfer !is ArtifactTransfer.Downloading && saveJob == null && pickerFile == null &&
        entry.size in 0..ARTIFACT_MAX_BYTES && (canStart || downloaded)
    Column(Modifier.padding(horizontal = 12.dp, vertical = 4.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            if (mime != null) TextButton(onClick = { request(ArtifactAction.Open) }, enabled = ready) { Label("打开文件", 14, 20) }
            TextButton(onClick = { request(ArtifactAction.Save) }, enabled = ready) { Label("保存文件", 14, 20) }
            if (transfer is ArtifactTransfer.Downloading) TextButton(onClick = { downloads.cancel(key) }) { Label("取消下载", 14, 20) }
        }
        val status = when (transfer) {
            is ArtifactTransfer.Downloading -> "已取回 ${fileSizeLabel(transfer.bytes)} / ${fileSizeLabel(entry.size)} · 关窗可继续"
            is ArtifactTransfer.Ready -> if (!downloaded) null else if (mime == null) "已下载，可保存到手机。" else "已下载，可打开或保存。"
            ArtifactTransfer.Failed -> "下载中断，请检查连接后重试。"
            ArtifactTransfer.Cancelled -> "已取消下载。"
            null -> null
        }
        status?.let { Label(it, 13, 18, color = Enso.colors.dim) }
        if (entry.size > ARTIFACT_MAX_BYTES) Label("已超过手机端 50 MiB 取回上限。", 13, 18, color = Enso.colors.dim)
        notice?.let { Label(it, 13, 18, color = Enso.colors.dim) }
    }
}
