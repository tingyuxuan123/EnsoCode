package io.github.tingyuxuan123.eaves

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.runtime.mutableStateOf
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.tingyuxuan123.eaves.mirror.DesktopSessionState
import io.github.tingyuxuan123.eaves.mirror.LinkPhase
import io.github.tingyuxuan123.eaves.mirror.SessionCommandPhase
import io.github.tingyuxuan123.eaves.mirror.SessionTextAttempt
import io.github.tingyuxuan123.eaves.mirror.DesktopQueuedMessage
import io.github.tingyuxuan123.eaves.mirror.DesktopQueueAttempt
import io.github.tingyuxuan123.eaves.mirror.QueueCommand
import io.github.tingyuxuan123.eaves.mirror.SessionImage
import io.github.tingyuxuan123.eaves.ui.LocalSessionPicture
import io.github.tingyuxuan123.eaves.ui.PictureDraftState
import io.github.tingyuxuan123.eaves.pair.SessionApproval
import io.github.tingyuxuan123.eaves.pair.SessionAsk
import io.github.tingyuxuan123.eaves.pair.SessionMessage
import io.github.tingyuxuan123.eaves.pair.SessionTimeline
import io.github.tingyuxuan123.eaves.ui.EnsoTheme
import io.github.tingyuxuan123.eaves.ui.SessionHeader
import io.github.tingyuxuan123.eaves.ui.SessionScreen
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SessionScreenTest {
    @get:Rule val compose = createComposeRule()
    private val approval = SessionApproval("approval-1", "bash", "command", "pnpm test")
    private val timeline = SessionTimeline("session-1", messages = listOf(
        SessionMessage(0, "user", listOf(JsonObject(mapOf("type" to JsonPrimitive("text"), "text" to JsonPrimitive("帮我检查"))))),
        SessionMessage(1, "assistant", listOf(JsonObject(mapOf("type" to JsonPrimitive("text"), "text" to JsonPrimitive("正在检查"))))),
    ))

    @Test fun approvalDisplaysOriginalSummaryAndEmitsExactDecision() {
        var emitted: Pair<String, String>? = null
        compose.setContent {
            EnsoTheme {
                SessionScreen(SessionHeader("测试会话"), DesktopSessionState(timeline.copy(approvals = listOf(approval)), loading = false),
                    LinkPhase.Online, false, {}, {}, {}, { requestId, decision -> emitted = requestId to decision }, { _, _ -> })
            }
        }
        compose.onNodeWithText("它想运行一条命令").assertIsDisplayed()
        compose.onNodeWithText("$ pnpm test").assertIsDisplayed()
        compose.onNodeWithText("允许").performClick()
        assertEquals("approval-1" to "allow", emitted)
    }

    @Test fun protectedPendingAndReadonlyDoNotExposeSessionWidePermission() {
        compose.setContent {
            EnsoTheme {
                SessionScreen(SessionHeader("测试会话"), DesktopSessionState(
                    timeline.copy(approvals = listOf(approval.copy(protected = true))), loading = false,
                    pendingResponses = setOf(approval.requestId)), LinkPhase.Online, true,
                    {}, {}, {}, { _, _ -> }, { _, _ -> })
            }
        }
        compose.onNodeWithText("本会话总是允许").assertDoesNotExist()
        compose.onNodeWithText("允许").assertIsNotEnabled()
        compose.onNodeWithText("拒绝").assertIsNotEnabled()
        compose.onNodeWithText("正在等待桌面确认").assertIsDisplayed()
    }

    @Test fun reviewingRequestHasNoHumanApprovalActions() {
        compose.setContent {
            EnsoTheme {
                SessionScreen(SessionHeader("测试会话"), DesktopSessionState(
                    timeline.copy(approvals = listOf(approval.copy(reviewing = true))), loading = false),
                    LinkPhase.Online, false, {}, {}, {}, { _, _ -> }, { _, _ -> })
            }
        }
        compose.onNodeWithText("允许").assertDoesNotExist()
        compose.onNodeWithText("拒绝").assertDoesNotExist()
        compose.onNodeWithText("正在由桌面审批策略检查").assertIsDisplayed()
    }

    @Test fun selectionOnlyUsesExactOptionAndHasNoFreeTextInput() {
        var emitted: Pair<String, String>? = null
        val ask = SessionAsk("ask-1", "选择输出格式", listOf("Short", "Detailed"), selectionOnly = true)
        compose.setContent {
            EnsoTheme {
                SessionScreen(SessionHeader("测试会话"), DesktopSessionState(timeline.copy(asks = listOf(ask)), loading = false),
                    LinkPhase.Online, false, {}, {}, {}, { _, _ -> }, { id, answer -> emitted = id to answer })
            }
        }
        compose.onNodeWithContentDescription("自由回答").assertDoesNotExist()
        compose.onNodeWithText("回答").assertIsNotEnabled()
        compose.onNodeWithText("Short").performClick()
        compose.onNodeWithText("回答").assertIsEnabled().performClick()
        assertEquals("ask-1" to "Short", emitted)
    }

    @Test fun textAnswerIsNotSubmittedWhileOfflineOrExpired() {
        val ask = SessionAsk("ask-1", "怎么继续", expiresAt = System.currentTimeMillis() - 1000)
        compose.setContent {
            EnsoTheme {
                SessionScreen(SessionHeader("测试会话"), DesktopSessionState(timeline.copy(asks = listOf(ask)), loading = false),
                    LinkPhase.Offline, false, {}, {}, {}, { _, _ -> }, { _, _ -> error("Must not submit") })
            }
        }
        compose.onNodeWithText("已到期").assertIsDisplayed()
        compose.onNodeWithText("回答").assertIsNotEnabled()
        compose.onNodeWithContentDescription("自由回答").assertIsNotEnabled()
    }

    @Test fun composerKeepsUnconfirmedDraftAndSeparatesSteerFromStop() {
        val state = mutableStateOf(DesktopSessionState(timeline.copy(status = "idle"), loading = false))
        val draft = mutableStateOf("")
        val sent = mutableListOf<Pair<String, Boolean>>()
        var stops = 0
        compose.setContent {
            EnsoTheme {
                SessionScreen(SessionHeader("测试会话"), state.value, LinkPhase.Online, false,
                    {}, {}, {}, { _, _ -> }, { _, _ -> }, draft = draft.value,
                    onDraft = { draft.value = it }, onText = { text, steer -> sent.add(text to steer) }, onStop = { stops++ })
            }
        }
        compose.onNodeWithContentDescription("发送").assertIsNotEnabled()
        compose.onNodeWithContentDescription("会话消息").performTextInput("first")
        compose.onNodeWithContentDescription("发送").performClick()
        assertEquals(listOf("first" to false), sent)
        compose.runOnIdle {
            state.value = state.value.copy(textAttempt = SessionTextAttempt(1, "first", SessionCommandPhase.Unconfirmed))
        }
        compose.onNodeWithText("未确认送达，草稿已保留。重发前请检查桌面。").assertIsDisplayed()
        assertEquals("first", draft.value)
        compose.runOnIdle {
            state.value = state.value.copy(timeline = timeline.copy(status = "running"),
                textAttempt = SessionTextAttempt(1, "first", SessionCommandPhase.Observed))
        }
        compose.waitForIdle()
        assertEquals("", draft.value)
        compose.onNodeWithContentDescription("会话消息").performTextInput("second")
        compose.onNodeWithText("插话").performClick()
        assertEquals(listOf("first" to false, "second" to true), sent)
        compose.onNodeWithContentDescription("停止").performClick()
        assertEquals(1, stops)
    }

    @Test fun queueDraftClearsOnlyWhenDesktopConfirmsAndStopRemainsSeparate() {
        val state = mutableStateOf(DesktopSessionState(timeline.copy(status = "running"), loading = false, queueReady = true))
        val draft = mutableStateOf("")
        val actions = mutableListOf<Triple<QueueCommand, String?, String?>>()
        compose.setContent { EnsoTheme {
            SessionScreen(SessionHeader("队列测试"), state.value, LinkPhase.Online, false,
                {}, {}, {}, { _, _ -> }, { _, _ -> }, draft = draft.value, onDraft = { draft.value = it },
                onQueue = { command, id, text -> actions.add(Triple(command, id, text)) })
        } }
        compose.onNodeWithContentDescription("会话消息").performTextInput("Queued draft")
        compose.onNodeWithText("加入队列").performClick()
        assertEquals(listOf(Triple(QueueCommand.Enqueue, null, "Queued draft")), actions)
        compose.runOnIdle {
            state.value = state.value.copy(queueAttempt = DesktopQueueAttempt(1, QueueCommand.Enqueue, null, "Queued draft", SessionCommandPhase.Waiting))
        }
        compose.onNodeWithText("排队中 · 1 条").assertDoesNotExist()
        compose.onNodeWithText("插话").assertIsNotEnabled()
        compose.onNodeWithContentDescription("停止").assertIsEnabled()
        assertEquals("Queued draft", draft.value)
        compose.runOnIdle {
            state.value = state.value.copy(queued = listOf(DesktopQueuedMessage("q", "Queued draft")),
                queueAttempt = state.value.queueAttempt!!.copy(phase = SessionCommandPhase.Observed))
        }
        compose.onNodeWithText("排队中 · 1 条").assertIsDisplayed()
        assertEquals("", draft.value)
        compose.onNodeWithText("Queued draft").performClick()
        compose.onNodeWithText("打断并发送").performClick()
        compose.onNodeWithText("确认打断并发送").performClick()
        assertEquals(Triple(QueueCommand.InterruptSend, "q", null), actions.last())
        compose.onNodeWithText("排队中 · 1 条").assertIsDisplayed()
    }

    @Test fun attachedPictureCannotBeDroppedBySteerOrQueueAndCanBeRemoved() {
        val image = LocalSessionPicture("local", SessionImage("invalid fixture data"), byteArrayOf(), 10)
        val pictures = mutableStateOf(PictureDraftState("session-1", listOf(image)))
        compose.setContent { EnsoTheme {
            SessionScreen(SessionHeader("图片草稿"), DesktopSessionState(timeline.copy(status = "running"), loading = false, queueReady = true),
                LinkPhase.Online, false, {}, {}, {}, { _, _ -> }, { _, _ -> }, draft = "图的说明",
                pictures = pictures.value, onPickPictures = {}, onRemovePicture = { pictures.value = pictures.value.copy(pictures = emptyList()) },
                onQueue = { _, _, _ -> error("Must not silently discard the picture") },
                onText = { _, _ -> error("Must not silently discard the picture") })
        } }
        compose.onNodeWithText("插话").assertIsNotEnabled()
        compose.onNodeWithText("加入队列").assertIsNotEnabled()
        compose.onNodeWithContentDescription("添加图片").assertIsNotEnabled()
        compose.onNodeWithContentDescription("停止").assertIsEnabled()
        compose.onNodeWithContentDescription("移除图片 1").performClick()
        compose.onNodeWithContentDescription("移除图片 1").assertDoesNotExist()
        compose.onNodeWithText("插话").assertIsEnabled()
        compose.onNodeWithText("加入队列").assertIsEnabled()
    }

    @Test fun timelineRendersAuthoritativeImagesAndOpensTheFullSizeView() {
        val png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
        val withImage = timeline.copy(messages = listOf(
            SessionMessage(0, "user", listOf(buildJsonObject {
                put("type", "image"); put("mimeType", "image/png"); put("data", png)
            })),
            SessionMessage(1, "user", listOf(buildJsonObject {
                // Valid base64 that is not an image: the strip must show a placeholder, not a broken frame.
                put("type", "image"); put("mimeType", "image/png"); put("data", "AAAA")
            })),
        ))
        compose.setContent { EnsoTheme {
            SessionScreen(SessionHeader("图片时间线"), DesktopSessionState(withImage, loading = false),
                LinkPhase.Online, false, {}, {}, {}, { _, _ -> }, { _, _ -> })
        } }
        compose.onNodeWithContentDescription("查看图片 1").assertIsDisplayed().performClick()
        compose.onNodeWithContentDescription("图片大图").assertIsDisplayed()
        compose.onNodeWithContentDescription("图片大图").performClick()
        compose.onNodeWithContentDescription("图片大图").assertDoesNotExist()
        // A payload that cannot be decoded keeps a placeholder instead of a broken frame.
        compose.onNodeWithText("图片无法显示").assertIsDisplayed()
    }
}
