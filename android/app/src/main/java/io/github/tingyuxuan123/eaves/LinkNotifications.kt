package io.github.tingyuxuan123.eaves

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import io.github.tingyuxuan123.eaves.mirror.LinkPhase

/** System-native notification surface: no codes, tool arguments, paths or model response bodies. */
internal class LinkNotifications(private val context: Context) {
    private val manager = context.getSystemService(NotificationManager::class.java)
    private val posted = mutableMapOf<String, TaskNotice>()
    init {
        manager.createNotificationChannels(listOf(
            NotificationChannel(LINK_CHANNEL, "后台连接", NotificationManager.IMPORTANCE_LOW),
            NotificationChannel(ATTENTION_CHANNEL, "审批、提问和错误", NotificationManager.IMPORTANCE_HIGH),
            NotificationChannel(DONE_CHANNEL, "任务完成", NotificationManager.IMPORTANCE_DEFAULT),
        ))
    }

    fun permitted(): Boolean = manager.areNotificationsEnabled() &&
        manager.getNotificationChannel(LINK_CHANNEL)?.importance != NotificationManager.IMPORTANCE_NONE &&
        (Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)

    fun service(token: String, state: CompanionState): Notification {
        val status = when (state.link.phase) {
            LinkPhase.Online -> "已连接${state.link.hostName?.take(80)?.let { " · $it" }.orEmpty()}"
            LinkPhase.Offline -> "连接中断，正在重试"
            LinkPhase.Replaced -> "已在其他设备打开"
            LinkPhase.Failed -> "连接验证失败"
            LinkPhase.AwaitingHost -> "等待电脑上线"
            LinkPhase.Authenticating -> "正在验证加密连接"
            else -> "正在连接电脑"
        }
        val stop = PendingIntent.getService(context, 0,
            Intent(context, LinkService::class.java).setAction(LinkService.STOP)
                .setData(android.net.Uri.Builder().scheme("eaves-internal").authority("stop-watch").appendPath(token).build())
                .putExtra(EXTRA_TOKEN, token), FLAGS)
        return Notification.Builder(context, LINK_CHANNEL).setSmallIcon(R.drawable.eaves_notification)
            .setContentTitle("小满 · 后台连接").setContentText(status)
            .setContentIntent(open(token)).setOngoing(true).setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_SERVICE).setVisibility(Notification.VISIBILITY_PRIVATE)
            .addAction(Notification.Action.Builder(null, "停止后台连接", stop).build()).build()
    }

    fun apply(token: String, changes: AlertChanges) {
        if (changes.cancellations.isEmpty() && changes.upserts.isEmpty()) return
        changes.cancellations.forEach { posted.remove(it); cancel(it) }
        if (!permitted()) return
        changes.upserts.forEach { notice ->
            posted[notice.sessionId] = notice
            val body = when (notice.kind) {
                TaskNoticeKind.Attention -> listOfNotNull(
                    "${notice.approvals} 个操作待审批".takeIf { notice.approvals > 0 },
                    "${notice.questions} 个问题待回答".takeIf { notice.questions > 0 }).joinToString(" · ")
                TaskNoticeKind.Failed -> "任务遇到错误，打开会话查看"
                TaskNoticeKind.Done -> "这一轮已结束，打开会话查看结果"
            }
            val channel = if (notice.kind == TaskNoticeKind.Done) DONE_CHANNEL else ATTENTION_CHANNEL
            val public = Notification.Builder(context, channel).setSmallIcon(R.drawable.eaves_notification)
                .setContentTitle("小满有任务更新").setContentText("解锁后打开查看").build()
            val notification = Notification.Builder(context, channel).setSmallIcon(R.drawable.eaves_notification)
                .setContentTitle(notice.title).setContentText(body).setStyle(Notification.BigTextStyle().bigText(body))
                .setContentIntent(open(token, notice.sessionId)).setAutoCancel(true).setOnlyAlertOnce(true)
                .setCategory(if (notice.kind == TaskNoticeKind.Attention) Notification.CATEGORY_MESSAGE else Notification.CATEGORY_STATUS)
                .setVisibility(Notification.VISIBILITY_PRIVATE).setPublicVersion(public)
                .apply { if (notice.kind == TaskNoticeKind.Done) setGroup(DONE_GROUP).setGroupAlertBehavior(Notification.GROUP_ALERT_CHILDREN) }.build()
            manager.notify(taskTag(notice.sessionId), TASK_ID, notification)
        }
        val finished = posted.values.filter { it.kind == TaskNoticeKind.Done }
        if (finished.size > 1) manager.notify(DONE_SUMMARY_ID, Notification.Builder(context, DONE_CHANNEL)
            .setSmallIcon(R.drawable.eaves_notification).setContentTitle("${finished.size} 个任务本轮已结束")
            .setStyle(Notification.InboxStyle().apply { finished.take(6).forEach { addLine(it.title) } })
            .setGroup(DONE_GROUP).setGroupSummary(true).setGroupAlertBehavior(Notification.GROUP_ALERT_CHILDREN)
            .setOnlyAlertOnce(true).setContentIntent(open(token)).setAutoCancel(true).setVisibility(Notification.VISIBILITY_PRIVATE).build())
        else manager.cancel(DONE_SUMMARY_ID)
    }

    fun updateService(token: String, state: CompanionState) {
        if (permitted()) manager.notify(SERVICE_ID, service(token, state))
    }

    private fun open(token: String, sessionId: String? = null): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).setAction(OPEN)
            .setData(android.net.Uri.Builder().scheme("eaves-internal").authority("watch").appendPath(token)
                .appendPath(sessionId.orEmpty()).build())
            .putExtra(EXTRA_TOKEN, token).putExtra(EXTRA_SESSION, sessionId)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        return PendingIntent.getActivity(context, 0, intent, FLAGS)
    }

    private fun cancel(sessionId: String) = manager.cancel(taskTag(sessionId), TASK_ID)
    fun clearTasks() {
        posted.clear()
        manager.cancel(DONE_SUMMARY_ID)
        manager.activeNotifications.filter { it.tag?.startsWith(TASK_TAG) == true }.forEach { manager.cancel(it.tag, it.id) }
    }

    companion object {
        const val SERVICE_ID = 700
        const val LINK_CHANNEL = "link"
        const val ATTENTION_CHANNEL = "attention"
        const val DONE_CHANNEL = "done"
        const val OPEN = "io.github.tingyuxuan123.eaves.OPEN_NOTICE"
        const val EXTRA_TOKEN = "eavesNoticeLease"
        const val EXTRA_SESSION = "eavesNoticeSession"
        private const val TASK_ID = 701
        private const val TASK_TAG = "eaves-task:"
        private const val DONE_SUMMARY_ID = 702
        private const val DONE_GROUP = "eaves-done"
        private const val FLAGS = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        private fun taskTag(sessionId: String) = TASK_TAG + sessionId
    }
}
