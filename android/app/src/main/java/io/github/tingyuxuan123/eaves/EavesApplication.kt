package io.github.tingyuxuan123.eaves

import android.app.Application
import android.os.Build
import io.github.tingyuxuan123.eaves.mirror.AndroidPairCredentialStore
import io.github.tingyuxuan123.eaves.mirror.DesktopLink
import io.github.tingyuxuan123.eaves.mirror.DesktopGoal
import io.github.tingyuxuan123.eaves.mirror.GoalCommand
import io.github.tingyuxuan123.eaves.mirror.MaintenanceBaseline
import io.github.tingyuxuan123.eaves.mirror.SessionMaintenanceCommand
import io.github.tingyuxuan123.eaves.mirror.RewindBaseline
import io.github.tingyuxuan123.eaves.mirror.SessionTaskKind
import io.github.tingyuxuan123.eaves.mirror.TaskStopBaseline
import io.github.tingyuxuan123.eaves.mirror.BotThreadCommand
import io.github.tingyuxuan123.eaves.mirror.DesktopBotArtifactTarget
import io.github.tingyuxuan123.eaves.mirror.RelayPairingClient
import io.github.tingyuxuan123.eaves.mirror.TaskLaunch
import io.github.tingyuxuan123.eaves.mirror.TaskThinkingLevel
import io.github.tingyuxuan123.eaves.mirror.SessionImage
import io.github.tingyuxuan123.eaves.mirror.QueueCommand
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

/** One foreground link per application process; credentials never enter a Compose state. */
class EavesApplication : Application() {
    internal val companion: CompanionController by lazy {
        val store = AndroidPairCredentialStore(this, allowLoopbackHttp = BuildConfig.DEBUG)
        val pairing = RelayPairingClient(allowLoopbackHttp = BuildConfig.DEBUG)
        val name = "${Build.MANUFACTURER} ${Build.MODEL}".take(64)
        CompanionController(store,
            claim = { link -> pairing.claim(link, name) }, revoke = pairing::revoke,
            linkFactory = { credentials, pin ->
                val link = DesktopLink(credentials, pin, allowLoopbackHttp = BuildConfig.DEBUG)
                object : CompanionLink {
                    override val state = link.state
                    override fun setVisible(visible: Boolean) = link.setVisible(visible)
                    override fun setBackgroundAllowed(allowed: Boolean) = link.setBackgroundAllowed(allowed)
                    override fun reconnect() = link.reconnect()
                    override fun selectSession(sessionId: String?) = link.selectSession(sessionId)
                    override fun retrySession() = link.retrySession()
                    override fun loadHistory(sessionId: String) = link.loadHistory(sessionId)
                    override fun respondApproval(sessionId: String, requestId: String, decision: String) =
                        link.respondApproval(sessionId, requestId, decision)
                    override fun respondAsk(sessionId: String, requestId: String, answer: String) =
                        link.respondAsk(sessionId, requestId, answer)
                    override fun submitText(sessionId: String, text: String, steer: Boolean) =
                        link.submitText(sessionId, text, steer)
                    override fun submitImages(sessionId: String, text: String, images: List<SessionImage>) =
                        link.submitImages(sessionId, text, images)
                    override fun stopSession(sessionId: String) = link.stopSession(sessionId)
                    override fun setSessionModel(sessionId: String, providerId: String, modelId: String) =
                        link.setModel(sessionId, providerId, modelId)
                    override fun setSessionReasoning(sessionId: String, enabled: Boolean) = link.setReasoning(sessionId, enabled)
                    override fun setSessionThinking(sessionId: String, level: TaskThinkingLevel) = link.setThinking(sessionId, level)
                    override fun queueAction(sessionId: String, command: QueueCommand, messageId: String?, text: String?) =
                        link.queueAction(sessionId, command, messageId, text)
                    override fun goalAction(sessionId: String, command: GoalCommand, expected: DesktopGoal?, text: String?) =
                        link.goalAction(sessionId, command, expected, text)
                    override fun maintain(sessionId: String, command: SessionMaintenanceCommand, baseline: MaintenanceBaseline,
                        text: String?) = link.maintain(sessionId, command, baseline, text)
                    override fun rewind(sessionId: String, userIndexFromEnd: Long, restoreFiles: Boolean, baseline: RewindBaseline) =
                        link.rewind(sessionId, userIndexFromEnd, restoreFiles, baseline)
                    override fun stopTask(sessionId: String, kind: SessionTaskKind, targetId: String, baseline: TaskStopBaseline) =
                        link.stopTask(sessionId, kind, targetId, baseline)
                    override fun listFiles(sessionId: String) = link.listFiles(sessionId)
                    override fun readFile(sessionId: String, fileId: String, offset: Long) =
                        link.readFile(sessionId, fileId, offset)
                    override fun listPreviews(sessionId: String) = link.listPreviews(sessionId)
                    override fun openPreview(sessionId: String, entryId: String, width: Int, height: Int) =
                        link.openPreview(sessionId, entryId, width, height)
                    override fun previewAction(sessionId: String, action: io.github.tingyuxuan123.eaves.mirror.DesktopPreviewAction) =
                        link.previewAction(sessionId, action)
                    override fun previewInput(sessionId: String,
                        input: io.github.tingyuxuan123.eaves.mirror.DesktopPreviewInput) = link.previewInput(sessionId, input)
                    override fun requestBots() = link.requestBots()
                    override fun requestInbox() = link.requestInbox()
                    override fun openBotChat(chatId: String) = link.openBotChat(chatId)
                    override fun loadBotTimeline(chatId: String, beforeSeq: Long?) = link.loadBotTimeline(chatId, beforeSeq)
                    override fun closeBotChat(chatId: String) = link.closeBotChat(chatId)
                    override fun sendBotMessage(chatId: String, text: String, deliveryId: String) =
                        link.sendBotMessage(chatId, text, deliveryId)
                    override fun stopBotChat(chatId: String) = link.stopBotChat(chatId)
                    override fun changeBotThread(rootId: String, command: BotThreadCommand, targetId: String?, expectedActiveId: String) =
                        link.changeBotThread(rootId, command, targetId, expectedActiveId)
                    override fun requestBotNewSession(chatId: String) = link.requestBotNewSession(chatId)
                    override fun confirmBotNewSession(chatId: String) = link.confirmBotNewSession(chatId)
                    override fun retryBotEntry(chatId: String, entryId: String) = link.retryBotEntry(chatId, entryId)
                    override fun dismissBotInboxItem(key: String) = link.dismissBotInboxItem(key)
                    override fun createBotGroup(title: String, memberIds: List<String>, bossBotId: String) = link.createBotGroup(title, memberIds, bossBotId)
                    override fun openBotDirect(botId: String) = link.openBotDirect(botId)
                    override fun loadBotArtifacts(target: DesktopBotArtifactTarget) = link.loadBotArtifacts(target)
                    override fun loadBotArtifactImage(target: DesktopBotArtifactTarget, mediaId: String?, rel: String?) =
                        link.loadBotArtifactImage(target, mediaId, rel)
                    override fun listBotFiles(target: DesktopBotArtifactTarget) = link.listBotFiles(target)
                    override fun readBotFile(target: DesktopBotArtifactTarget, fileId: String, offset: Long) = link.readBotFile(target, fileId, offset)
                    override fun createTask(request: TaskLaunch) = link.createTask(request)
                    override fun dismissCreation(sessionId: String?) = link.dismissCreation(sessionId)
                    override fun close() = link.close()
                }
            }, scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate))
    }
}
