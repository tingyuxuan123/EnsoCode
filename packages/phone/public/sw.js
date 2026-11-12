/**
 * Web Push Service Worker：桌面 main 直发的推送在此落地为系统通知。
 * 载荷只含通用文案 + sessionId（消息内容不出加密信道），点击通知
 * 聚焦已开窗口（postMessage 让 App 切会话）或带参新开。
 */

/** 与 packages/phone/src/launchSession.ts 同名：iOS 冷启动常丢掉 query */
const LAUNCH_SESSION_CACHE = 'enso-phone-launch';
const LAUNCH_SESSION_URL = '/__open-session';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = { title: 'Collabra', body: '', sessionId: '' };
  try {
    payload = { ...payload, ...event.data.json() };
  } catch {
    // 载荷解析失败也要弹通知：iOS 要求每个 push 事件必须 showNotification
  }
  const notify = self.registration.showNotification(payload.title, {
    body: payload.body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: payload.sessionId || 'enso',
    data: { sessionId: payload.sessionId },
  });
  const badge =
    (payload.title === '需要审批' || payload.title === '等待你的回答') &&
    typeof self.registration.setAppBadge === 'function'
      ? self.registration.setAppBadge(1).catch(() => {})
      : null;
  event.waitUntil(badge ? Promise.all([notify, badge]) : notify);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const sessionId = event.notification.data?.sessionId || '';
  const target = sessionId ? `/?session=${encodeURIComponent(sessionId)}` : '/';
  event.waitUntil(
    (async () => {
      if (sessionId) {
        try {
          const cache = await caches.open(LAUNCH_SESSION_CACHE);
          await cache.put(
            LAUNCH_SESSION_URL,
            new Response(sessionId, { headers: { 'Content-Type': 'text/plain' } })
          );
        } catch {}
      }
      const windows = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      const existing =
        windows.find((client) => client.focused) ||
        windows.find((client) => client.visibilityState === 'visible') ||
        windows[0];
      if (existing) {
        existing.postMessage({ type: 'open-session', sessionId });
        return existing.focus();
      }
      return self.clients.openWindow(target);
    })()
  );
});
