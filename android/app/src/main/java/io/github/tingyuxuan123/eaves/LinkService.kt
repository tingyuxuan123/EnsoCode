package io.github.tingyuxuan123.eaves

import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import io.github.tingyuxuan123.eaves.mirror.LinkPhase
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch

/** A foreground lease for the app's existing DesktopLink, never a second socket or a sticky restart. */
class LinkService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val companion get() = (application as EavesApplication).companion
    private lateinit var notifications: LinkNotifications
    private var lease: String? = null
    private var observer: Job? = null

    override fun onCreate() {
        super.onCreate()
        notifications = LinkNotifications(this)
        notifications.clearTasks()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val token = intent?.getStringExtra(LinkNotifications.EXTRA_TOKEN)
        if (intent?.action == STOP) {
            if (token != null && lease == token) {
                companion.stopWatch(token)
                stopSelf()
            } else if (lease == null) stopSelf(startId)
            return START_NOT_STICKY
        }
        val state = companion.state.value
        if (intent?.action != START || token == null || state.watch.token != token) {
            if (lease == null) stopSelf(startId)
            return START_NOT_STICKY
        }
        if (lease == token) return START_NOT_STICKY
        if (!notifications.permitted()) {
            companion.stopWatch(token, failed = true)
            stopSelf(startId)
            return START_NOT_STICKY
        }
        try {
            val foreground = notifications.service(token, state)
            if (Build.VERSION.SDK_INT >= 34) startForeground(LinkNotifications.SERVICE_ID, foreground, ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING)
            else startForeground(LinkNotifications.SERVICE_ID, foreground)
        } catch (_: RuntimeException) {
            companion.stopWatch(token, failed = true)
            stopSelf(startId)
            return START_NOT_STICKY
        }
        lease = token
        if (!companion.activateWatch(token)) {
            stopSelf(startId)
            return START_NOT_STICKY
        }
        val alerts = SessionAlerts()
        observer?.cancel()
        observer = scope.launch {
            var lastStatus: Pair<LinkPhase, String?>? = null
            combine(companion.state, companion.uiVisible) { next, visible -> next to visible }.collect { (next, visible) ->
                if (lease != token) return@collect
                if (next.watch.token != token || next.watch.phase != WatchPhase.Active || !notifications.permitted()) {
                    companion.stopWatch(token, failed = next.watch.token == token && !notifications.permitted())
                    stopSelf()
                    return@collect
                }
                val status = next.link.phase to next.link.hostName
                if (status != lastStatus) {
                    lastStatus = status
                    notifications.updateService(token, next)
                }
                val rows = next.link.catalog.takeIf { next.link.phase == LinkPhase.Online && next.link.catalogReady }
                notifications.apply(token, alerts.update(rows, visible, enabled = true))
            }
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        scope.cancel()
        lease?.let { companion.stopWatch(it) }
        stopForeground(STOP_FOREGROUND_REMOVE)
        notifications.clearTasks()
        super.onDestroy()
    }

    internal companion object {
        const val START = "io.github.tingyuxuan123.eaves.START_WATCH"
        const val STOP = "io.github.tingyuxuan123.eaves.STOP_WATCH"
    }
}
