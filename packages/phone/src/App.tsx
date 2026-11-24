import {
  type CatalogEntry,
  type PairedDevice,
  type ProjectEntry,
  type ProjectGroupEntry,
  type ProviderEntry,
  revokePairing,
} from '@enso/pair';
import { parseCompactCommand } from '@shared/compactCommand';
import { MonitorSmartphone, PanelLeft, ScanLine, Unlink } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { composerDrafts } from '@/components/chat/composerDraft';
import { Button } from '@/components/ui/button';
import { applyAppBadge, attentionBadgeCount } from './attentionBadge';
import { ChatScreen } from './ChatScreen';
import { type ConnState, PairClient, type SessionView } from './client';
import { phoneCommandRejection } from './commandRejection';
import { formatOnlineConnectionLabel } from './connectionLabel';
import { pickActive, removeDevice, renameDevice, upsertDevice } from './deviceList';
import { FileDownloadsRoot } from './FileDownloads';
import { FileTransferPort } from './fileTransferPort';
import { parseSessionFromSearch, parseSessionId, takeStashedSessionId } from './launchSession';
import { useMediaQuery, WIDE_LAYOUT_QUERY } from './media';
import { NewSessionSheet } from './NewSessionSheet';
import { PairScreen } from './PairScreen';
import { PreviewPort } from './previewPort';
import {
  isPushSupported,
  isStandalone,
  type PushFailureReason,
  registerServiceWorker,
  subscribePush,
  unsubscribePush,
} from './push';
import {
  captureQueueSendEcho,
  type QueueSendEcho,
  retainQueueSendEchoes,
  userTextsOf,
  withoutQueuedIds,
} from './queueSendEcho';
import { READ_ONLY_ERROR } from './readOnly';
import { SessionConfigSheet } from './SessionConfigSheet';
import { SessionDrawer } from './SessionDrawer';
import { SessionImagePort, type SessionImageTarget } from './sessionImagePort';
import {
  clearDeviceData,
  loadActiveDeviceId,
  loadDevices,
  loadLastSession,
  saveActiveDeviceId,
  saveDevices,
  saveLastSession,
} from './storage';
import { setPhoneAgentActions } from './stubs/electron-api';
import { setQueueActions } from './stubs/sessions-store';
import { usePhoneBack } from './usePhoneBack';
import { usePhoneScreenBack } from './usePhoneScreenBack';
import { shouldHoldWakeLock, syncWakeLock } from './wakeLock';

/**
 * 扫码直达：桌面二维码是 https 链接，系统相机可直接打开本页并带上 #relay=…&pk=…。
 * 取出后立即抹掉 hash，避免公钥留在地址栏/历史里，也避免刷新时重复配对。
 */
function takeInviteFromUrl(): string | null {
  const hash = window.location.hash.replace(/^#/, '');
  if (!hash.includes('pk=')) return null;
  const link = window.location.href;
  history.replaceState(null, '', window.location.pathname + window.location.search);
  return link;
}

const STATE_LABEL: Record<ConnState, string> = {
  connecting: '连接中…',
  online: '已连接',
  'host-offline': '桌面端离线',
  unauthorized: '配对已失效',
  offline: '重连中…',
  replaced: '已在其他页面连接',
};

const PUSH_ENABLED_KEY = 'enso-phone-push';
const SIDEBAR_PINNED_KEY = 'enso-phone-sidebar-pinned';

/** 通知点击冷启动时带的 ?session=：取出即抹掉，优先于上次会话 */
function takeSessionFromUrl(): string | null {
  const sessionId = parseSessionFromSearch(window.location.search);
  if (!sessionId) return null;
  const params = new URLSearchParams(window.location.search);
  params.delete('session');
  const query = params.toString();
  history.replaceState(null, '', window.location.pathname + (query ? `?${query}` : ''));
  return sessionId;
}

/** 推送可用性：iOS 必须先添加到主屏幕才有 pushManager */
function pushAvailability(): 'ok' | 'needs-install' | 'unsupported' {
  if (isPushSupported()) return 'ok';
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  return isIos && !isStandalone() ? 'needs-install' : 'unsupported';
}

export function App() {
  const [devices, setDevices] = useState(loadDevices);
  const [activeDeviceId, setActiveDeviceId] = useState(loadActiveDeviceId);
  /** 活跃桌面：失配（已被删）回落第一台；无配对时为 null 进配对页 */
  const device = pickActive(devices, activeDeviceId);
  // 只在首次挂载时取一次：内部会抹掉 hash，重复调用取不到
  const [urlInvite] = useState(takeInviteFromUrl);
  /** 已配对状态下的「配对新电脑」流程（覆盖 PairScreen） */
  const [adding, setAdding] = useState(false);
  const [state, setState] = useState<ConnState>('connecting');
  const [connectionRevision, setConnectionRevision] = useState(0);
  const [transport, setTransport] = useState<'relay' | 'direct'>('relay');
  const [rttMs, setRttMs] = useState<number | null>(null);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  /** 桌面置顶组的手动拖拽顺序（旧桌面不下发，空 = 按活跃倒序） */
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [projectGroups, setProjectGroups] = useState<ProjectGroupEntry[]>([]);
  const [providers, setProviders] = useState<ProviderEntry[]>([]);
  const [urlSession] = useState(takeSessionFromUrl);
  const [initialSession] = useState(() => urlSession ?? loadLastSession(device?.pairId ?? null));
  const [activeId, setActiveId] = useState<string | null>(initialSession);
  const [view, setView] = useState<SessionView | null>(null);
  /** 订阅会话同步中（subscribe 已发、snapshot 未回）：此时时间线可能是陈旧的 */
  const [syncing, setSyncing] = useState(false);
  /** 等同步应答超时的会话：桌面端给不出正文时显示可重试的失败态，不永久转圈 */
  const [syncFailedId, setSyncFailedId] = useState<string | null>(null);
  /** 上滑翻页在途的会话 */
  const [historyPending, setHistoryPending] = useState<ReadonlySet<string>>(new Set());
  /** 马上发送：本地乐观上墙，等权威 user 消息到达再收掉 */
  const [queueEchoes, setQueueEchoes] = useState<QueueSendEcho[]>([]);
  // iPad 横屏等宽窗口：会话列表常驻左栏，不走浮层抽屉、也不自动收起
  const wide = useMediaQuery(WIDE_LAYOUT_QUERY);
  // 宽屏下用户可选侧栏常驻/折叠（折叠后走浮层抽屉）；选择持久化，默认常驻
  const [sidebarPinned, setSidebarPinned] = useState(
    () => localStorage.getItem(SIDEBAR_PINNED_KEY) !== 'off'
  );
  const docked = wide && sidebarPinned;
  const {
    drawerOpen,
    backToConversation,
    openDrawer: showDrawer,
    closeDrawer: hideDrawer,
  } = usePhoneScreenBack({
    enabled: Boolean(device && !adding && state !== 'unauthorized'),
    docked,
    initialListOpen: !initialSession,
  });
  const toggleSidebarPinned = () => {
    setSidebarPinned((prev) => {
      localStorage.setItem(SIDEBAR_PINNED_KEY, prev ? 'off' : 'on');
      return !prev;
    });
  };
  const [composing, setComposing] = useState(false);
  /** 从抽屉项目旁进入时预填；顶栏新建为 null */
  const [composeProjectId, setComposeProjectId] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(
    () => localStorage.getItem(PUSH_ENABLED_KEY) === 'on'
  );
  /** 已收到桌面下发的 push-config；旧版桌面不会发，开关据此提示升级 */
  const [pushConfigReady, setPushConfigReady] = useState(false);
  const [voiceInput, setVoiceInput] = useState(false);
  const [filesAvailable, setFilesAvailable] = useState(false);
  /** 桌面能按权威根解析会话里的图片（旧桌面没有 images 能力，保持纯文本回退） */
  const [imagesAvailable, setImagesAvailable] = useState(false);
  const [previewAvailable, setPreviewAvailable] = useState(false);
  /** 桌面把本设备设为只读（host-info.readOnly） */
  const [deviceReadOnly, setDeviceReadOnly] = useState(false);
  /** 有写操作被桌面以只读拦下：横幅改为明确提示 */
  const [readOnlyRejected, setReadOnlyRejected] = useState(false);
  /** 订阅进行中：开关乐观显示已开但禁用，避免数秒无反馈 */
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState<PushFailureReason | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const filesPort = useMemo(
    () =>
      new FileTransferPort((command) => {
        if (!clientRef.current) return false;
        clientRef.current.send(command);
      }),
    []
  );
  const previewPort = useMemo(
    () =>
      new PreviewPort((command) => {
        if (!clientRef.current) return false;
        clientRef.current.send(command);
      }),
    []
  );
  const imagesPort = useMemo(
    () =>
      new SessionImagePort((command) => {
        if (!clientRef.current) return false;
        clientRef.current.send(command);
      }),
    []
  );
  const clientRef = useRef<PairClient | null>(null);
  const activeIdRef = useRef<string | null>(activeId);
  const catalogRef = useRef(catalog);
  const viewRef = useRef(view);
  catalogRef.current = catalog;
  viewRef.current = view;
  activeIdRef.current = activeId;
  /** VAPID 公钥（桌面下发）；用 ref 避免重建连接 effect */
  const vapidKeyRef = useRef<string | null>(null);

  // SW 常驻注册（通知点击路由依赖它）+ 监听点击通知的切会话消息
  // biome-ignore lint/correctness/useExhaustiveDependencies: SW 消息路由注册一次；内部判定用最新状态
  useEffect(() => {
    void registerServiceWorker();
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; sessionId?: string };
      if (data?.type !== 'open-session') return;
      const sessionId = parseSessionId(data.sessionId);
      if (!sessionId) return;
      setActiveId(sessionId);
      closeDrawer();
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, []);
  useEffect(() => {
    applyAppBadge(attentionBadgeCount(catalog));
  }, [catalog]);

  useEffect(() => {
    const sync = () => {
      void syncWakeLock(
        shouldHoldWakeLock(document.visibilityState === 'visible' && state === 'online', catalog)
      );
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    document.addEventListener('pointerdown', sync, { passive: true });
    return () => {
      document.removeEventListener('visibilitychange', sync);
      document.removeEventListener('pointerdown', sync);
      void syncWakeLock(false);
    };
  }, [catalog, state]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 恢复会话按 urlSession 变化触发；closeDrawer 内自查最新布局
  useEffect(() => {
    if (urlSession) {
      void takeStashedSessionId();
      return;
    }
    void takeStashedSessionId().then((id) => {
      if (!id) return;
      setActiveId(id);
      closeDrawer();
    });
  }, [urlSession]);

  // 已配对状态下扫桌面二维码（地址栏带 #pk=）：进入添加流程，不再覆盖旧配对
  // biome-ignore lint/correctness/useExhaustiveDependencies: 只在挂载时判一次
  useEffect(() => {
    if (urlInvite && devices.length > 0) setAdding(true);
  }, []);

  // 只按凭据重建连接：重命名只换 label，不该断重连，故用字段级依赖
  // biome-ignore lint/correctness/useExhaustiveDependencies: 见上，device 按 pairId/token/relayUrl/contentKey 变化才重连
  useEffect(() => {
    if (!device) return;
    // 换绑另一台桌面时清掉上一台的 VAPID 公钥，等新桌面重新下发
    vapidKeyRef.current = null;
    setPushConfigReady(false);
    setHistoryPending(new Set());
    setTransport('relay');
    setVoiceInput(false);
    setFilesAvailable(false);
    setPreviewAvailable(false);
    setImagesAvailable(false);
    previewPort.reset();
    filesPort.reset();
    imagesPort.reset();
    setDeviceReadOnly(false);
    setReadOnlyRejected(false);
    const rejectedReadOnly = () => {
      setDeviceReadOnly(true);
      setReadOnlyRejected(true);
    };
    const client = new PairClient(device, {
      onState: (next) => {
        if (next !== 'online') {
          filesPort.reset();
          previewPort.reset();
          imagesPort.reset();
        }
        setState(next);
      },
      onFilesAvailable: setFilesAvailable,
      onFileReply: (frame) => filesPort.receive(frame),
      onImagesAvailable: setImagesAvailable,
      onSessionImage: (frame) => imagesPort.receive(frame),
      onPreviewAvailable: setPreviewAvailable,
      onPreviewReply: (frame) => previewPort.receive(frame),
      onTransport: (next) => {
        setTransport(next);
        setRttMs(null);
      },
      onRtt: setRttMs,
      onVoiceInput: setVoiceInput,
      onReadOnly: (readOnly) => {
        setDeviceReadOnly(readOnly);
        if (!readOnly) setReadOnlyRejected(false);
      },
      onCommandRejected: (command, error) => {
        if (error === READ_ONLY_ERROR) rejectedReadOnly();
        // 图片命令被本地拦下（离线/握手超时）：在途请求立刻失败，别让预览空转到超时
        if (command === 'session-image') imagesPort.reset('offline');
        const rejected = phoneCommandRejection(command, error);
        if (rejected.notice) setNotice(rejected.notice);
        if (rejected.clearQueueEchoes) setQueueEchoes([]);
      },
      onCatalog: (entries) => {
        setCatalog(entries);
      },
      onProjects: (next, groups) => {
        setProjects(next);
        setProjectGroups(groups ?? []);
      },
      onProviders: setProviders,
      onSession: (id, next) => {
        setView((prev) => (id === activeIdRef.current ? next : prev));
      },
      onSync: (state) => setSyncing(state === 'syncing'),
      onSyncFailed: (sessionId, failed) =>
        setSyncFailedId((prev) => (failed ? sessionId : prev === sessionId ? null : prev)),
      onGhostSession: (id) => {
        // 订阅的会话已在桌面被删：跳回列表态，由 firstId 兑底选最近一条
        if (id === activeIdRef.current) setActiveId(null);
      },
      onHistoryPending: (id, pending) => {
        setHistoryPending((prev) => {
          const next = new Set(prev);
          if (pending) next.add(id);
          else next.delete(id);
          return next;
        });
      },
      onPushConfig: (key) => {
        vapidKeyRef.current = key;
        setPushConfigReady(true);
        // 已开启则每次连上都重新登记：订阅幂等，且能修复桌面侧订阅丢失
        if (localStorage.getItem(PUSH_ENABLED_KEY) === 'on') {
          void subscribePush(key).then((result) => {
            if (result.ok)
              client.send({ type: 'push-subscribe', subscription: result.subscription });
          });
        }
      },
    });
    clientRef.current = client;
    client.connect();
    // 切后台时系统会掐死或冻结 socket 且不触发 close：回前台/网络恢复立即探活。
    // 退后台瞬间赶在冻结前上报不可见：桌面据此把关键事件转系统推送
    //（半开 socket 不会 close，光靠 peer-left 桌面要很久才知道手机不在看）
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        client.nudge('visibility');
        client.send({ type: 'presence', visible: true });
      } else {
        client.conceal();
        client.send({ type: 'presence', visible: false });
        client.flushCache();
      }
    };
    const onOnline = () => {
      if (document.visibilityState === 'visible') {
        client.nudge('online');
        client.send({ type: 'presence', visible: true });
      }
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (document.visibilityState !== 'visible') return;
      // bfcache 回来的 socket 几乎一定是半开，当网络恢复拆掉
      client.nudge(event.persisted ? 'online' : 'visibility');
      client.send({ type: 'presence', visible: true });
    };
    const onFocus = () => {
      if (document.visibilityState === 'visible') client.nudge('visibility');
    };
    const onPageHide = () => {
      client.conceal();
      client.flushCache();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pagehide', onPageHide);
      client.close();
      clientRef.current = null;
      filesPort.reset();
      previewPort.reset();
    };
  }, [device?.pairId, device?.token, device?.relayUrl, device?.contentKey, connectionRevision]);

  /** 手机刚 spawn 的会话 id（一次性）：首次订阅不进 syncing——全新会话没有历史可陈旧，
   * 而 spawn 在途时 host 回的快照不含它，会让「同步中」横幅挂到切会话才消 */
  const freshIdsRef = useRef(new Set<string>());
  // biome-ignore lint/correctness/useExhaustiveDependencies: pairId 变化时也要在新 client 上重订阅
  useEffect(() => {
    // 用 has 而非读时删除：StrictMode 下 effect 双跑，第二跑不能把标记吞掉；切走时才消费
    const fresh = activeId !== null && freshIdsRef.current.has(activeId);
    clientRef.current?.subscribe(activeId, { fresh });
    for (const id of freshIdsRef.current) {
      if (id !== activeId) freshIdsRef.current.delete(id);
    }
    setView(activeId ? (clientRef.current?.getSession(activeId) ?? null) : null);
  }, [activeId, device?.pairId, connectionRevision]);

  const pairId = device?.pairId;
  useEffect(() => {
    if (pairId) saveLastSession(pairId, activeId);
  }, [activeId, pairId]);

  // 排队区复用桌面组件，它经 store 桩调用这些方法；这里转成 pair 命令发回桌面
  useEffect(() => {
    // 马上发送：先本地出队+上墙，再发命令。steer 要等当前轮边界，权威 user 晚到。
    const echoQueuedNow = (sessionId: string, messageId: string) => {
      const queued = catalogRef.current.find((entry) => entry.id === sessionId)?.queued;
      const messages =
        sessionId === activeIdRef.current && viewRef.current
          ? [...viewRef.current.messages.values()]
          : [];
      const echo = captureQueueSendEcho(queued, sessionId, messageId, userTextsOf(messages));
      if (echo) setQueueEchoes((prev) => [...prev, echo]);
    };
    setQueueActions({
      removeQueuedMessage: (sessionId, messageId) =>
        clientRef.current?.send({ type: 'queue-remove', sessionId, messageId }),
      updateQueuedMessage: (sessionId, messageId, text) =>
        clientRef.current?.send({ type: 'queue-update', sessionId, messageId, text }),
      sendQueuedNow: (sessionId, messageId) => {
        echoQueuedNow(sessionId, messageId);
        clientRef.current?.send({ type: 'queue-send-now', sessionId, messageId });
      },
      interruptAndSendQueued: async (sessionId, messageId) => {
        echoQueuedNow(sessionId, messageId);
        clientRef.current?.send({ type: 'queue-interrupt-send', sessionId, messageId });
      },
      pauseGoal: (sessionId) => clientRef.current?.send({ type: 'goal-pause', sessionId }),
      resumeGoal: (sessionId) => clientRef.current?.send({ type: 'goal-resume', sessionId }),
      clearGoal: (sessionId) => clientRef.current?.send({ type: 'goal-clear', sessionId }),
      rewind: (sessionId, userIndexFromEnd, restoreFiles) =>
        clientRef.current?.send({
          type: 'rewind',
          sessionId,
          userIndexFromEnd,
          ...(restoreFiles ? { restoreFiles } : {}),
        }),
      retry: (sessionId) => clientRef.current?.send({ type: 'retry', sessionId }),
    });
    setPhoneAgentActions({
      stopTask: (sessionId, taskId) =>
        clientRef.current?.send({ type: 'task-stop', sessionId, taskId }),
      stopSubagent: (sessionId, agentId) =>
        clientRef.current?.send({ type: 'subagent-stop', sessionId, agentId }),
    });
  }, []);

  const lastRunRef = useRef<{ id: string; running: boolean } | null>(null);
  useEffect(() => {
    if (!activeId) return;
    const texts = userTextsOf(view ? [...view.messages.values()] : []);
    const running = view?.status === 'running';
    const last = lastRunRef.current;
    const turnSettled = last?.id === activeId && last.running && !running;
    lastRunRef.current = { id: activeId, running };
    setQueueEchoes((prev) => {
      const next = retainQueueSendEchoes(prev, activeId, texts, { turnSettled });
      return next.length === prev.length && next.every((echo, index) => echo === prev[index])
        ? prev
        : next;
    });
  }, [view, activeId]);

  // 首次连上且没有选中会话时，落到最近一条
  const firstId = catalog.find((c) => !c.parentId)?.id;
  useEffect(() => {
    if (!activeId && firstId) setActiveId(firstId);
  }, [activeId, firstId]);

  const entry = useMemo(() => catalog.find((c) => c.id === activeId), [catalog, activeId]);
  /*
   * 会话图片读取/失效回调保持稳定身份：内联函数每次渲染都换身份会让
   * useLocalImageSource 重新发请求（断线时表现为一直「正在读取图片…」）。
   */
  const sessionImageCwd = entry?.cwd;
  const activeReadImage = useMemo(
    () =>
      imagesAvailable && activeId
        ? (target: SessionImageTarget) => imagesPort.load(activeId, target, sessionImageCwd)
        : undefined,
    [imagesAvailable, activeId, sessionImageCwd, imagesPort]
  );
  const activeInvalidateImage = useMemo(
    () =>
      imagesAvailable && activeId
        ? (target: SessionImageTarget) => imagesPort.evict(activeId, target, sessionImageCwd)
        : undefined,
    [imagesAvailable, activeId, sessionImageCwd, imagesPort]
  );
  // coworker tab 组：当前会话是子会话则归组到其父，否则以自身为父；无 coworker 时不显示
  const tabGroup = useMemo(() => {
    if (!entry) return undefined;
    const parent = entry.parentId ? catalog.find((c) => c.id === entry.parentId) : entry;
    if (!parent) return undefined;
    const children = catalog.filter((c) => c.parentId === parent.id);
    return children.length > 0 ? { parent, children } : undefined;
  }, [catalog, entry]);
  // 子会话（coworker）跟随父会话模型，与桌面一致不提供切换
  const configurable = entry && !entry.parentId;
  const modelLabel = configurable
    ? (providers.find((p) => p.id === entry.providerId)?.models.find((m) => m.id === entry.modelId)
        ?.label ??
      entry.modelId ??
      '选择模型')
    : undefined;

  // 在线时附带业务帧出口（直连 / 中继）：顶栏副标题与抽屉设备行共用
  const connectionLabel =
    state === 'online' ? formatOnlineConnectionLabel(transport, rttMs) : STATE_LABEL[state];

  /** 切到另一台时清空上一台的目录/视图，等新桌面下发 */
  const resetHostState = (nextSessionId: string | null) => {
    setCatalog([]);
    setProjects([]);
    setProjectGroups([]);
    setProviders([]);
    setView(null);
    setSyncing(false);
    setQueueEchoes([]);
    setRttMs(null);
    setNotice(null);
    setActiveId(nextSessionId);
  };

  const switchDevice = (pairId: string) => {
    if (pairId === device?.pairId) {
      if (state === 'replaced') {
        setState('connecting');
        setConnectionRevision((value) => value + 1);
      }
      return;
    }
    saveActiveDeviceId(pairId);
    setActiveDeviceId(pairId);
    // 旧连接状态不属于新桌面：乐观置回连接中，避免闪现 unauthorized/host-offline 旧屏
    setState('connecting');
    resetHostState(loadLastSession(pairId));
    closeDrawer();
  };

  const addDevice = (d: PairedDevice) => {
    const next = upsertDevice(devices, d);
    setDevices(next);
    saveDevices(next);
    saveActiveDeviceId(d.pairId);
    setActiveDeviceId(d.pairId);
    resetHostState(loadLastSession(d.pairId));
    setAdding(false);
  };

  const unpairDevice = (pairId: string) => {
    const target = devices.find((d) => d.pairId === pairId);
    // 手机侧持 deviceToken，可一并清掉中继房间（桌面重连即被拒）；已被对端解绑时失败无妄
    if (target) void revokePairing(target.relayUrl, target.pairId, target.token).catch(() => {});
    // 先停旧 client 的缓存写入，再删缓存；不能等 React effect 清理时重新写回。
    if (pairId === device?.pairId) clientRef.current?.close();
    clearDeviceData(pairId);
    const next = removeDevice(devices, pairId);
    setDevices(next);
    saveDevices(next);
    if (pairId === (device?.pairId ?? null)) {
      const fallback = pickActive(next, null);
      saveActiveDeviceId(fallback?.pairId ?? null);
      setActiveDeviceId(fallback?.pairId ?? null);
      if (fallback) setState('connecting');
      resetHostState(loadLastSession(fallback?.pairId ?? null));
      if (!fallback) closeDrawer();
    }
  };

  const handleRename = (pairId: string, label: string) => {
    const next = renameDevice(devices, pairId, label);
    setDevices(next);
    saveDevices(next);
  };

  usePhoneBack(Boolean(device && adding), () => setAdding(false), 20);

  if (!device || adding) {
    return (
      <PairScreen
        autoInvite={urlInvite}
        onPaired={addDevice}
        onCancel={device ? () => setAdding(false) : undefined}
      />
    );
  }

  if (state === 'unauthorized') {
    const others = devices.length > 1;
    return (
      // 设计稿 `expired`：配对失效 ≠ 离线，重连没用，只能重新配对
      <div className="flex h-full flex-col overflow-hidden bg-page">
        <div className="flex flex-1 flex-col items-center justify-center px-8 pb-16 text-center">
          <span className="flex size-16 items-center justify-center rounded-full bg-card shadow-[0_0_0_0.75px_rgb(0_0_0/0.05)]">
            <Unlink className="size-7 text-dim" aria-hidden />
          </span>
          <h1 className="mt-5 text-[22px] leading-7 font-bold tracking-[-0.01em]">配对已失效</h1>
          <p className="mt-2 text-[14px] leading-[22px] text-dim">
            「{device.label}」和这台手机的连接被解除了——可能是桌面端解绑，也可能太久没连过。
          </p>
          <div className="mt-6 flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => unpairDevice(device.pairId)}
              className="glass-ink flex h-12 items-center gap-2 rounded-full px-5 text-[15px] font-medium"
            >
              <ScanLine className="size-[18px]" aria-hidden />
              {others ? '移除此配对' : '重新配对'}
            </button>
            {others && (
              <button
                type="button"
                onClick={showDrawer}
                className="glass flex h-12 items-center gap-2 rounded-full px-5 text-[15px] font-medium"
              >
                <MonitorSmartphone className="size-[18px]" aria-hidden />
                换台电脑
              </button>
            )}
          </div>
        </div>
        <div className="px-4 pb-10">
          <div className="rounded-[18px] bg-card px-4 py-3.5">
            <p className="text-[13px] leading-[18px] font-medium">对话不会丢</p>
            <p className="mt-1 text-[13px] leading-[20px] text-dim">
              历史都在电脑上。重新配对后还是原来那些会话，只是这台手机要重新拿一次访问权。
            </p>
          </div>
        </div>
      </div>
    );
  }

  const send = (command: Parameters<PairClient['send']>[0]) => clientRef.current?.send(command);

  // 宽屏常驻左栏下「关掉抽屉」是空操作；窄屏照旧收起。直接查 matchMedia，闭包里也拿得到旋转后的最新值
  const closeDrawer = () => {
    // 常驻左栏下「关掉抽屉」是空操作；折叠或窄屏照旧收起
    if (
      localStorage.getItem(SIDEBAR_PINNED_KEY) === 'off' ||
      !window.matchMedia(WIDE_LAYOUT_QUERY).matches
    ) {
      hideDrawer();
    }
  };

  const openDrawer = showDrawer;

  const voice = voiceInput
    ? (onPartial: Parameters<PairClient['startVoice']>[0]) =>
        clientRef.current?.startVoice(onPartial) ?? {
          push: () => {},
          finish: () => Promise.resolve({ ok: false as const, error: 'failed' as const }),
          cancel: () => {},
        }
    : undefined;

  const togglePush = async (next: boolean) => {
    setPushError(null);
    if (!next) {
      localStorage.setItem(PUSH_ENABLED_KEY, 'off');
      setPushEnabled(false);
      send({ type: 'push-unsubscribe' });
      void unsubscribePush();
      return;
    }
    const key = vapidKeyRef.current;
    if (!key) return; // 还没收到 push-config（未连上桌面），开关保持关闭
    // 乐观翻开 + busy：权限弹框与 FCM 注册要几秒，开关不动会被误认为没开
    setPushEnabled(true);
    setPushBusy(true);
    const result = await subscribePush(key);
    setPushBusy(false);
    if (!result.ok) {
      setPushEnabled(false);
      setPushError(result.reason);
      return;
    }
    send({ type: 'push-subscribe', subscription: result.subscription });
    localStorage.setItem(PUSH_ENABLED_KEY, 'on');
  };

  return (
    <FileDownloadsRoot
      port={filesPort}
      available={filesAvailable}
      online={state === 'online'}
      preview={{ port: previewPort, available: previewAvailable, readOnly: deviceReadOnly }}
    >
      <SessionDrawer
        open={docked || drawerOpen}
        docked={docked}
        backToConversation={backToConversation}
        pinnable={wide}
        onTogglePinned={toggleSidebarPinned}
        projects={projects}
        groups={projectGroups}
        catalog={catalog}
        activeId={activeId}
        canCreate={state === 'online' && !deviceReadOnly}
        devices={devices}
        activeDevicePairId={device.pairId}
        connected={state === 'online'}
        connectionLabel={connectionLabel}
        deviceReadOnly={deviceReadOnly}
        onClose={() => closeDrawer()}
        onSelect={(id) => {
          setActiveId(id);
          closeDrawer();
        }}
        onNewConversation={(projectId) => {
          closeDrawer();
          setComposeProjectId(projectId);
          setComposing(true);
        }}
        pushEnabled={pushEnabled}
        pushBusy={pushBusy}
        pushError={pushError}
        pushAvailability={pushAvailability()}
        pushConfigReady={pushConfigReady}
        onTogglePush={(next) => void togglePush(next)}
        onSwitchDevice={switchDevice}
        onAddDevice={() => {
          closeDrawer();
          setAdding(true);
        }}
        onRenameDevice={handleRename}
        onUnpairDevice={unpairDevice}
      />
      <div
        inert={drawerOpen && !docked}
        aria-hidden={drawerOpen && !docked}
        className="flex h-full min-w-0 flex-1 flex-col"
      >
        {state === 'replaced' && (
          <div
            role="status"
            className="flex shrink-0 flex-wrap items-center justify-center gap-2 border-b bg-muted px-3 py-2 text-muted-foreground text-xs"
          >
            <span>
              同一配对已在其他页面打开，当前页面已暂停连接，避免反复闪烁。历史和配对数据已保留。
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setState('connecting');
                setConnectionRevision((value) => value + 1);
              }}
            >
              在此页面连接
            </Button>
          </div>
        )}
        {wide && !docked && !drawerOpen && (
          // 宽屏折叠态的展开入口：左缘中部把手，不与各屏头部按钮冲突，任何界面都能唤回侧栏
          <button
            type="button"
            onClick={openDrawer}
            aria-label="打开会话列表"
            className="fixed top-1/2 left-0 z-40 flex h-16 w-6 -translate-y-1/2 items-center justify-center rounded-r-lg border border-l-0 bg-background/90 text-muted-foreground shadow-sm backdrop-blur transition-colors hover:bg-accent hover:text-foreground"
          >
            <PanelLeft className="h-4.5 w-4.5" />
          </button>
        )}
        <ChatScreen
          sessionId={activeId}
          title={entry?.title || (activeId ? '会话' : 'CodeKiln')}
          projectName={entry?.projectName ?? ''}
          cwd={entry?.cwd}
          readImage={activeReadImage}
          invalidateImage={activeInvalidateImage}
          view={view}
          connState={state}
          stateLabel={connectionLabel}
          syncing={syncing && Boolean(activeId)}
          syncFailed={syncFailedId !== null && syncFailedId === activeId}
          onRetrySync={() => {
            setSyncFailedId(null);
            clientRef.current?.retrySync();
          }}
          onOpenDrawer={openDrawer}
          drawerDocked={docked}
          onNewSession={() => {
            setComposeProjectId(null);
            setComposing(true);
          }}
          canCreate={state === 'online' && projects.length > 0 && !deviceReadOnly}
          modelLabel={state === 'online' ? modelLabel : undefined}
          onOpenConfig={() => setConfigOpen(true)}
          tabGroup={tabGroup}
          onSelectTab={setActiveId}
          hasOlder={Boolean(
            activeId && view && view.messages.size > 0 && Math.min(...view.messages.keys()) > 0
          )}
          historyLoading={Boolean(activeId && historyPending.has(activeId))}
          onLoadOlder={() => activeId && clientRef.current?.requestHistory(activeId)}
          voice={voice}
          queued={withoutQueuedIds(entry?.queued, queueEchoes, activeId ?? '')}
          echoes={queueEchoes}
          notice={notice}
          goal={entry?.goal}
          context={entry?.context}
          usageTotals={entry?.usageTotals}
          slashCommands={entry?.slashCommands}
          deviceReadOnly={deviceReadOnly}
          readOnlyRejected={readOnlyRejected}
          onSend={(text, images) => {
            if (!activeId) return;
            const compact = parseCompactCommand(text);
            if (compact) {
              send({
                type: 'compact',
                sessionId: activeId,
                ...(compact.instructions ? { instructions: compact.instructions } : {}),
              });
              return;
            }
            const goalMatch = /^\/goal(?:\s+([\s\S]+))?$/.exec(text.trim());
            if (goalMatch) {
              const arg = goalMatch[1]?.trim();
              if (!arg) return;
              if (arg === 'clear') send({ type: 'goal-clear', sessionId: activeId });
              else if (arg === 'pause') send({ type: 'goal-pause', sessionId: activeId });
              else if (arg === 'resume') send({ type: 'goal-resume', sessionId: activeId });
              else send({ type: 'goal-set', sessionId: activeId, text: arg });
              return;
            }
            // 与桌面同语义：轮次进行中先入队（可编辑/删除/立即发送/打断并发送）
            send({
              type: view?.status === 'running' ? 'enqueue' : 'prompt',
              sessionId: activeId,
              text,
              ...(images.length ? { images } : {}),
            });
          }}
          onAbort={() => activeId && send({ type: 'abort', sessionId: activeId })}
          onApproval={(requestId, decision) =>
            activeId && send({ type: 'approval-respond', sessionId: activeId, requestId, decision })
          }
          onAsk={(requestId, answer) =>
            activeId && send({ type: 'ask-respond', sessionId: activeId, requestId, answer })
          }
        />

        <NewSessionSheet
          open={composing && !deviceReadOnly}
          projects={projects}
          providers={providers}
          preferredProjectId={composeProjectId}
          connectionLabel={`${device.label} · ${STATE_LABEL[state]}`}
          recentSessions={catalog.filter((item) => !item.parentId && !item.archived).slice(0, 2)}
          onSelectSession={(id) => {
            setComposing(false);
            setComposeProjectId(null);
            setActiveId(id);
          }}
          onClose={() => {
            setComposing(false);
            setComposeProjectId(null);
          }}
          onCreate={(req) => {
            const sessionId = crypto.randomUUID();
            const { draft, ...spawn } = req;
            if (draft) {
              composerDrafts.set(sessionId, {
                segments: draft.text ? [{ type: 'text', text: draft.text }] : [],
                images: draft.images ?? [],
                slash: null,
              });
            }
            send({ type: 'spawn', sessionId, ...spawn });
            freshIdsRef.current.add(sessionId);
            setComposing(false);
            setComposeProjectId(null);
            setActiveId(sessionId);
          }}
        />

        {configurable && activeId && !deviceReadOnly && (
          <SessionConfigSheet
            open={configOpen}
            providers={providers}
            config={{
              providerId: entry.providerId,
              modelId: entry.modelId,
              reasoningEnabled: entry.reasoningEnabled,
              thinkingLevel: entry.thinkingLevel,
            }}
            onClose={() => setConfigOpen(false)}
            onSetModel={(providerId, modelId) =>
              send({ type: 'set-model', sessionId: activeId, providerId, modelId })
            }
            onSetReasoning={(enabled) =>
              send({ type: 'set-reasoning', sessionId: activeId, enabled })
            }
            onSetThinking={(level) => send({ type: 'set-thinking', sessionId: activeId, level })}
          />
        )}
      </div>
    </FileDownloadsRoot>
  );
}
