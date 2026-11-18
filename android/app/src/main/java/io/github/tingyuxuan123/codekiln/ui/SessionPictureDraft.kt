package io.github.tingyuxuan123.eaves.ui

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import io.github.tingyuxuan123.eaves.mirror.SESSION_IMAGE_BYTES
import io.github.tingyuxuan123.eaves.mirror.SESSION_IMAGE_LIMIT

internal data class PictureDraftState(val owner: String? = null, val pictures: List<LocalSessionPicture> = emptyList(),
    val loading: Boolean = false, val error: String? = null)
internal data class PictureTicket(val owner: String, val generation: Long)

internal class SessionPictureDraft(private val scope: CoroutineScope,
    private val prepare: suspend (List<String>, Int) -> List<LocalSessionPicture>) {
    private val mutable = MutableStateFlow(PictureDraftState())
    val state: StateFlow<PictureDraftState> = mutable.asStateFlow()
    private var generation = 0L
    private var importJob: Job? = null
    private data class Submission(val text: String, val ids: List<String>, val fingerprints: List<String>, val afterId: Long)
    private var submitted: Submission? = null

    fun bind(owner: String?) {
        if (mutable.value.owner == owner) return
        generation++
        importJob?.cancel()
        importJob = null
        submitted = null
        mutable.value = PictureDraftState(owner)
    }

    fun ticket(): PictureTicket? = mutable.value.owner?.let { PictureTicket(it, generation) }

    fun select(ticket: PictureTicket?, sources: List<String>) {
        val old = mutable.value
        if (ticket == null || ticket != ticket() || old.loading || sources.isEmpty()) return
        if (sources.size > SESSION_IMAGE_LIMIT - old.pictures.size) {
            mutable.value = old.copy(error = "每条消息最多附 4 张图片，请减少选择数量。")
            return
        }
        val remaining = SESSION_IMAGE_BYTES - old.pictures.sumOf { it.jpegBytes }
        if (remaining < sources.size) {
            mutable.value = old.copy(error = "图片预算已用完，请先移除一张。")
            return
        }
        mutable.value = old.copy(loading = true, error = null)
        importJob = scope.launch {
            try {
                val pictures = prepare(sources, remaining)
                if (ticket != ticket()) return@launch
                if (pictures.size != sources.size || pictures.any { it.jpegBytes <= 0 } || pictures.sumOf { it.jpegBytes } > remaining) {
                    throw PictureImportException("图片大小超出预算，请减少张数。")
                }
                val live = mutable.value
                mutable.value = live.copy(pictures = live.pictures + pictures, loading = false, error = null)
            } catch (error: CancellationException) { throw error }
            catch (error: Exception) {
                if (ticket == ticket()) mutable.value = mutable.value.copy(loading = false, error = (error as? PictureImportException)?.userMessage
                    ?: "无法读取图片，请检查图片或重新选择。")
            }
        }
    }

    fun remove(id: String) {
        if (!mutable.value.loading) mutable.value = mutable.value.copy(pictures = mutable.value.pictures.filterNot { it.id == id }, error = null)
    }

    fun sent(text: String, afterId: Long = 0) {
        val pictures = mutable.value.pictures
        if (pictures.isNotEmpty()) submitted = Submission(text, pictures.map { it.id }, pictures.map { it.image.fingerprint }, afterId)
    }

    /** Retire only the submitted attachment IDs; any subsequently added images and edited caption stay put. */
    fun observed(owner: String, text: String, fingerprints: List<String>, attemptId: Long = 1): String? {
        val attempt = submitted ?: return null
        val current = mutable.value
        val normalized = attempt.text.takeUnless { it.all { ch -> ch.isWhitespace() || ch == '\uFEFF' } }.orEmpty()
        if (current.owner != owner || attemptId <= attempt.afterId || normalized != text || attempt.fingerprints != fingerprints) return null
        submitted = null
        val ids = current.pictures.map { it.id }
        if (ids.none { it in attempt.ids }) return null
        // A late confirmation may arrive during import. The import merges only into the live draft.
        mutable.value = current.copy(pictures = current.pictures.filterNot { it.id in attempt.ids })
        return attempt.text.takeIf { ids == attempt.ids }
    }
}
