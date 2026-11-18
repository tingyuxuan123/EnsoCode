import type { CatalogEntry } from '@enso/pair';
import { localCompactionNoticeIndex } from '@shared/pair/guestProjection';
import type { AttachedImage, ProjectedMessage, SlashCommand } from '@shared/types/agent';
import type { StartVoiceSession } from '@shared/types/speech';
import { ArrowUp, Bot, EllipsisVertical, Loader2, Lock } from 'lucide-react';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ApprovalBar } from '@/components/chat/ApprovalBar';
import { AskBar } from '@/components/chat/AskBar';
import { Composer } from '@/components/chat/Composer';
import { ChatHostContext } from '@/components/chat/chatHost';
import { GoalBar } from '@/components/chat/GoalBar';
import { MessageQueue } from '@/components/chat/MessageQueue';
import {
  CHAT_COL,
  MessageTimeline,
  type MessageTimelineHandle,
} from '@/components/chat/MessageTimeline';
import { RetryBar } from '@/components/chat/RetryBar';
import { usePinnedTodos } from '@/components/chat/TodoBar';
import { cn } from '@/lib/utils';
import { buildTimeline } from '@/stores/sessions/timeline';
import { BotArtifacts } from './BotArtifacts';
import { artifactMessageTarget } from './botArtifactsPort';
import { ConversationMenu } from './ConversationMenu';
import { phoneChatHost } from './chatHost';
import type { ConnState, SessionView } from './client';
import { FileDownloads } from './FileDownloads';
import { compressWithin, imageBudget } from './image';
import { PhoneTaskBar } from './PhoneTaskBar';
import { PhoneTopBar, TopBarAction } from './PhoneTopBar';
import { appendEchoMessages, type QueueSendEcho } from './queueSendEcho';
import { readOnlyBanner } from './readOnly';
import { SessionStatsLine } from './SessionStatsLine';
import type { SessionImageLoad } from './sessionImagePort';
import { setDisplayedConversation } from './stubs/sessions-store';
import { WebPreview } from './WebPreview';

interface Props {
  sessionId: string | null;
  title: string;
  projectName: string;
  /** 工具执行目录：项目内绝对路径在时间线里收成相对路径 */
  cwd?: string;
  view: SessionView | null;
  /** 本机时钟 − host 时钟（审批 / 提问卡剩余时间） */
  clockOffset?: number;
  /** 会话图片：手机没有 local-image://，由 host 按「会话 id + 相对路径」读回 data URL */
  readImage?: (rel: string) => Promise<SessionImageLoad>;
  /** 解码失败/同路径覆盖时作废该图缓存，重试才会重新取图 */
  invalidateImage?: (rel: string) => void;
  connState: ConnState;
  stateLabel: string;
  /** Local send failure, also shown in Code mode (not only Bot conversations). */
  notice?: string | null;
  /** 订阅会话同步中：标题旁状态灯用 amber pulse */
  syncing?: boolean;
  /** 等同步应答超时且本机没有正文：显示可重试的失败态，不永久转圈 */
  syncFailed?: boolean;
  onRetrySync?: () => void;
  canCreate: boolean;
  onOpenDrawer(): void;
  /** 大屏横屏侧栏已常驻：左上不再显示抽屉入口（bot.onBack 仍优先显示返回） */
  drawerDocked?: boolean;
  onNewSession(): void;
  newSessionHint?: string;
  newSessionBusy?: boolean;
  /** 当前模型标签；undefined = 子会话或目录未含模型信息，不显示切换入口 */
  modelLabel?: string;
  onOpenConfig?(): void;
  /** 还有更早的历史可上滑加载 */
  hasOlder?: boolean;
  /** 上滑翻页在途 */
  historyLoading?: boolean;
  onLoadOlder?(): void;
  /** 桌面语音识别可用时才给：Composer 据此显示麦克风 */
  voice?: StartVoiceSession;
  /** coworker tab 组（仅当父会话雇有 coworker 时有值）：主会话 + 子会话 */
  tabGroup?: { parent: CatalogEntry; children: CatalogEntry[] };
  onSelectTab?(sessionId: string): void;
  /** 排队中的消息（桌面下发）：本轮未结束时发的消息先入队 */
  queued?: { id: string; text: string; hasImages?: boolean }[];
  /** 马上发送的本地乐观回显：steer 送达前浮在权威消息之后 */
  echoes?: QueueSendEcho[];
  /** 会话目标（桌面下发）：GoalBar 展示与暂停/继续/清除 */
  goal?: CatalogEntry['goal'];
  /** 输入框下状态栏的上下文占用（桌面下发） */
  context?: CatalogEntry['context'];
  usageTotals?: CatalogEntry['usageTotals'];
  slashCommands?: SlashCommand[];
  onSend(text: string, images: AttachedImage[]): void;
  onAbort(): void;
  onApproval(requestId: string, decision: 'allow' | 'allowSession' | 'deny'): void;
  onAsk(requestId: string, answer: string): void;
  /** Bot 成员会话：发送走 bot-send，无回退/重试/斜杠命令；readOnly = 群聊「查看过程」 */
  bot?: {
    chatId?: string;
    readOnly?: boolean;
    onBack?(): void;
    notice?: string | null;
    outbox?: ReactNode;
  };
  /** Bot 私聊：每轮最终回复下方挂产物卡片与 send_image 图 */
  artifacts?: { chatId: string; conversationId: string };
  /** 桌面把本设备设为只读：只能查看，隐藏输入/审批/回答等写操作 */
  deviceReadOnly?: boolean;
  /** 有写操作刚被桌面以只读拦下 */
  readOnlyRejected?: boolean;
}

/** 会话页：复用桌面的时间线 / 审批条 / 输入框，保持与桌面一致的渲染 */
export function ChatScreen(props: Props) {
  const { view, sessionId } = props;
  const timelineRef = useRef<MessageTimelineHandle>(null);
  const [sending, setSending] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // tabs sliding：pill 位置/尺寸由 JS 测量写入，CSS 负责补间；首帧挂起过渡避免从 0 宽飞入
  const tabsRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const pillReady = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: effect 通过 ref 读写 DOM，依赖项是重定位 pill/镜像层的真实触发信号
  useLayoutEffect(() => {
    const bar = tabsRef.current;
    const pill = pillRef.current;
    const active = bar?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!bar || !pill || !active) return;
    if (!pillReady.current) pill.style.transition = 'none';
    pill.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
    pill.style.width = `${active.offsetWidth}px`;
    pill.style.height = `${active.offsetHeight}px`;
    if (!pillReady.current) {
      void pill.offsetWidth;
      pill.style.transition = '';
      pillReady.current = true;
    }
  }, [sessionId, props.tabGroup]);
  const running = view?.status === 'running';
  const pendingInput = Boolean(view?.approvals.length || view?.asks.length);
  const bot = props.bot;
  const readOnly = Boolean(bot?.readOnly || props.deviceReadOnly || props.connState === 'replaced');
  /** 同步有界重试已耗尽：本机缓存正文照常显示，但不能再宣称「同步中…」 */
  const syncFailed = Boolean(props.syncFailed);
  const syncing = Boolean(props.syncing) && !syncFailed;
  const entries = useMemo(
    () => (view ? [...view.messages.entries()].sort((a, b) => a[0] - b[0]) : []),
    [view]
  );
  const messageIndices = useMemo(() => entries.map(([index]) => index), [entries]);
  const artifactChatId = props.artifacts?.chatId;
  const artifactConversationId = props.artifacts?.conversationId;
  const host = useMemo(
    () => ({
      ...phoneChatHost({
        sessionId,
        bot,
        deviceReadOnly: props.deviceReadOnly,
        cwd: props.cwd,
        readImage: props.readImage,
        invalidateImage: props.invalidateImage,
      }),
      ...(artifactChatId && artifactConversationId
        ? {
            turnFooter: (localIndex: number) => {
              const target = artifactMessageTarget(
                artifactChatId,
                artifactConversationId,
                messageIndices,
                localIndex
              );
              return target ? (
                <>
                  <BotArtifacts target={target} />
                  <div className="mt-1.5">
                    <WebPreview target={{ bot: target }}>网页预览</WebPreview>
                  </div>
                </>
              ) : null;
            },
          }
        : {}),
    }),
    [
      sessionId,
      bot,
      props.deviceReadOnly,
      props.cwd,
      props.readImage,
      props.invalidateImage,
      artifactChatId,
      artifactConversationId,
      messageIndices,
    ]
  );
  const slashCommands = useMemo<SlashCommand[]>(() => {
    if (bot) return [];
    const base: SlashCommand[] = [
      {
        name: '/goal',
        description: 'Set a session goal (/goal <objective> · pause · resume · clear)',
      },
      {
        name: '/compact',
        description: 'Compact the context now (/compact [summary focus])',
      },
    ];
    const extra = (props.slashCommands ?? []).filter(
      (command) => command.name !== '/goal' && command.name !== '/compact'
    );
    return [...base, ...extra];
  }, [props.slashCommands, bot]);

  const messages = useMemo<ProjectedMessage[]>(
    () =>
      appendEchoMessages(
        entries.map(([, message]) => message),
        props.echoes ?? [],
        sessionId ?? ''
      ),
    [entries, props.echoes, sessionId]
  );
  const started = messages.length > 0 || view?.status === 'running' || view?.status === 'failed';

  // 供复用组件内部读取（RunningElapsed 计时；Rewind/Retry 入口）
  setDisplayedConversation(
    sessionId
      ? {
          id: sessionId,
          projectId: '',
          status: view?.status ?? 'idle',
          started,
          spawning: false,
          messages,
          historyBaseIndex: entries[0]?.[0] ?? 0,
          historyLoading: props.historyLoading,
          queuedMessages: props.queued?.map((q) => ({ id: q.id, text: q.text })),
        }
      : null,
    props.hasOlder ? props.onLoadOlder : undefined
  );
  const pinnedTodos = usePinnedTodos(sessionId ?? '');

  const timeline = useMemo(
    () =>
      buildTimeline(messages, running, [], props.cwd, {
        pendingApprovals: view?.approvals,
        compaction: view?.compaction,
        // 尾窗是稀疏绝对 index，buildTimeline 要的是数组下标
        compactionNoticeAt: localCompactionNoticeIndex(
          entries.map(([index]) => index),
          view?.compactionNoticeAt
        ),
      }),
    [
      messages,
      entries,
      running,
      props.cwd,
      view?.approvals,
      view?.compaction,
      view?.compactionNoticeAt,
    ]
  );

  /*
   * 上滑分页的滚动锚定：iOS Safari 不支持 overflow-anchor，旧页插到顶部后
   * scrollTop 不动、内容整体下压，画面会跳到更早的消息。请求前记下
   * scrollHeight，旧页渲染完（最早 index 变小）用差值补偿 scrollTop。
   */
  const minIndex = view?.messages.size ? Math.min(...view.messages.keys()) : null;
  const anchorRef = useRef<{ height: number; top: number } | null>(null);
  const loadOlder = useCallback(() => {
    if (!props.hasOlder || !props.onLoadOlder) return;
    const el = timelineRef.current?.getScroller();
    anchorRef.current = el ? { height: el.scrollHeight, top: el.scrollTop } : null;
    props.onLoadOlder();
  }, [props.hasOlder, props.onLoadOlder]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: minIndex 变小 = 旧页已渲染，此时才补偿
  useLayoutEffect(() => {
    const el = timelineRef.current?.getScroller();
    const anchor = anchorRef.current;
    if (!el || !anchor) return;
    anchorRef.current = null;
    el.scrollTop = anchor.top + (el.scrollHeight - anchor.height);
  }, [minIndex]);

  /*
   * 兜底跟随：Virtuoso 的 followOutput 只在 data 长度变化时触发，而流式输出是
   * 按同一 index 覆盖最后一条、长度不变，于是不会跟随。这里在时间线内容变化时
   * 补一次单帧贴底——不能用 scrollToBottom，那会为每次更新都起一个纠正循环，
   * 叠在一起抢滚动位置会让画面闪烁。贴底判定用 Virtuoso 自己的（自己算
   * scrollHeight 会被 increaseViewportBy 的预渲染空间干扰，距底永远归不了零）。
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: timeline 是触发信号，effect 内只用 ref
  useEffect(() => {
    if (timelineRef.current?.isAtBottom()) timelineRef.current.pinToBottom();
  }, [timeline]);

  const send = async (text: string, images: AttachedImage[]) => {
    setSending(true);
    try {
      // 手机拍照动辄数 MB，压到单帧上限内再发
      const budget = imageBudget(images.length);
      const compressed: AttachedImage[] = [];
      for (const image of images) {
        compressed.push(await compressImageIfNeeded(image, budget));
      }
      props.onSend(text, compressed);
      timelineRef.current?.scrollToBottom();
    } finally {
      setSending(false);
    }
  };

  return (
    <ChatHostContext.Provider value={host}>
      <div className="phone-chat-root relative flex h-full min-h-0 flex-col">
        <PhoneTopBar
          lead={bot?.onBack ? 'back' : props.drawerDocked ? 'none' : 'menu'}
          leadLabel={bot?.onBack ? '返回群聊' : '打开会话列表'}
          {...(bot?.onBack
            ? { onLead: bot.onBack }
            : props.drawerDocked
              ? {}
              : { onLead: props.onOpenDrawer })}
          title={props.title}
          detail={
            <>
              {props.connState !== 'host-offline' &&
                props.connState !== 'unauthorized' &&
                props.connState !== 'replaced' && (
                  <span
                    data-sync-state={
                      props.connState !== 'online'
                        ? 'conn'
                        : syncFailed
                          ? 'failed'
                          : syncing
                            ? 'syncing'
                            : 'ok'
                    }
                    className={cn(
                      'mr-1 inline-block size-1.5 shrink-0 rounded-full align-middle',
                      props.connState === 'online' && !syncing && !syncFailed
                        ? 'bg-green'
                        : syncFailed
                          ? 'bg-yellow'
                          : 'animate-pulse bg-yellow'
                    )}
                    title={
                      props.connState !== 'online'
                        ? props.stateLabel
                        : syncFailed
                          ? '未读到最新历史'
                          : syncing
                            ? '同步中…'
                            : props.stateLabel
                    }
                  />
                )}
              {subjectLine(props.projectName, props.modelLabel) || props.stateLabel}
            </>
          }
          {...(props.onOpenConfig && !bot
            ? { detailMenu: true, onDetail: props.onOpenConfig }
            : {})}
        >
          {bot?.readOnly ? (
            <span className="size-12 shrink-0" />
          ) : (
            <TopBarAction label="会话菜单" onClick={() => setMenuOpen(true)}>
              <EllipsisVertical className="size-6" aria-hidden />
            </TopBarAction>
          )}
        </PhoneTopBar>

        {props.connState === 'host-offline' && (
          <div className="flex shrink-0 items-center justify-center gap-1.5 border-b border-warning/20 bg-warning/10 px-3 py-1.5 text-warning text-xs">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            <span>{props.stateLabel}</span>
          </div>
        )}

        {/*
         * 本机已有缓存正文但同步有界重试耗尽：正文继续显示，这里只挂一条不遮挡的提示，
         * 让用户知道看到的是旧内容并且可以重试。连接不在线时归因给连接状态（那条横幅已在上面），
         * 不能宣称「桌面端没有回应」。
         */}
        {syncFailed && view !== null && props.connState === 'online' && (
          <div
            data-sync-failed-banner=""
            className="mx-4 mt-1 flex shrink-0 flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-[14px] bg-yellow/10 px-3 py-2 text-center text-[12px] leading-4 text-yellow-ink"
          >
            {/* 窄屏一行放不下时先省略正文，按钮必须始终可点 */}
            <span className="min-w-0 flex-1 truncate">
              未读到最新历史：桌面端没有回应这次同步，下面是缓存内容。
            </span>
            <button
              type="button"
              onClick={props.onRetrySync}
              className="shrink-0 rounded-full bg-card px-2.5 py-1 text-[11px] leading-4 font-medium text-ink2"
            >
              重试
            </button>
          </div>
        )}

        {/* coworker tab 条：与桌面 CoworkerTabs 同观感，无 coworker 时不渲染；手机不提供雇佣/解雇 */}
        {props.tabGroup && props.tabGroup.children.length > 0 && (
          <div
            ref={tabsRef}
            role="tablist"
            className="t-tabs relative flex shrink-0 items-center justify-start gap-1.5 overflow-x-auto px-4 pb-2"
          >
            <span
              ref={pillRef}
              aria-hidden="true"
              className="t-tabs-pill pointer-events-none absolute top-0 left-0 z-0 rounded-full bg-pill"
            />
            <button
              type="button"
              role="tab"
              aria-selected={sessionId === props.tabGroup.parent.id}
              className={tabClass(sessionId === props.tabGroup.parent.id)}
              onClick={() => props.onSelectTab?.(props.tabGroup?.parent.id ?? '')}
            >
              <span className="max-w-40 truncate">主会话</span>
            </button>
            {props.tabGroup.children.map((child) => (
              <button
                key={child.id}
                type="button"
                role="tab"
                aria-selected={sessionId === child.id}
                className={tabClass(sessionId === child.id)}
                onClick={() => props.onSelectTab?.(child.id)}
              >
                <Bot className="h-3 w-3 shrink-0" />
                <span className="max-w-28 truncate">{child.title || 'coworker'}</span>
                <span
                  className={cn(
                    'h-1.5 w-1.5 shrink-0 rounded-full',
                    child.status === 'running'
                      ? 'animate-pulse bg-brand'
                      : child.status === 'failed'
                        ? 'bg-destructive'
                        : 'bg-muted-foreground/30'
                  )}
                />
              </button>
            ))}
          </div>
        )}

        {props.deviceReadOnly && (
          <div className="mx-5 mb-2 flex items-start gap-2 rounded-[14px] bg-card2 px-3 py-2.5">
            <Lock className="mt-0.5 size-3.5 shrink-0 text-dim" aria-hidden />
            <p className="min-w-0 flex-1 text-[12px] leading-[18px] text-ink2">
              {readOnlyBanner(props.readOnlyRejected)}
            </p>
          </div>
        )}
        {sessionId &&
          (props.goal || view?.tasks.length || view?.subagents.length || pinnedTodos) && (
            <div className="phone-session-bars shrink-0 px-5 pb-2">
              {props.goal && !readOnly && (
                <GoalBar conversationId={sessionId} goal={{ ...props.goal, noProgressRuns: 0 }} />
              )}
              <PhoneTaskBar
                sessionId={sessionId}
                tasks={view?.tasks ?? []}
                subagents={view?.subagents ?? []}
                readOnly={readOnly}
                online={props.connState === 'online'}
                todos={pinnedTodos}
              />
            </div>
          )}

        {sessionId === null ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
            <span className="mb-3 flex size-11 items-center justify-center rounded-[13px] border border-brand/20 bg-brand/8 text-brand dark:bg-brand/14">
              <img src="/icons/logo-192.png" alt="CodeKiln" className="size-6" />
            </span>
            <p className="font-semibold text-[22px] tracking-tight">CodeKiln</p>
            <p className="text-muted-foreground text-sm">
              {props.connState === 'online' ? '从左上角选择会话，或新建一个' : props.stateLabel}
            </p>
          </div>
        ) : view === null && syncFailed ? (
          // 桌面端一直给不出这个会话的正文（resume 被拒 / 快照始终没回）：
          // 有界重试已耗尽，明确失败并让用户重试，而不是永远转圈
          <div className="flex flex-1 flex-col items-center justify-center gap-2.5 px-6 text-center">
            <p className="text-sm text-muted-foreground">
              {props.connState === 'online'
                ? '没读到会话历史：桌面端没有回应这个会话。请确认桌面端仍在运行后重试。'
                : `${props.stateLabel}。恢复连接后会自动继续读取历史。`}
            </p>
            {props.connState === 'online' && (
              <button
                type="button"
                onClick={props.onRetrySync}
                className="rounded-full bg-pill px-4 py-2 text-[13px] leading-5 font-medium text-pill-ink"
              >
                重试
              </button>
            )}
          </div>
        ) : (
          <MessageTimeline
            key={sessionId}
            ref={timelineRef}
            items={timeline}
            // 本地已有正文就不要盖「正在读取历史」；无正文且同步中才是加载态
            busy={view === null ? syncing : running}
            loading={view === null}
            running={running}
            error={undefined}
            emptyTitle={props.projectName || 'CodeKiln'}
            // 手机端不虚拟化：见 MessageTimeline 里 virtualize 的说明
            virtualize={false}
            historyLoading={props.historyLoading}
            hasOlder={props.hasOlder}
            olderCursor={minIndex ?? 0}
            onStartReached={props.hasOlder ? loadOlder : undefined}
          />
        )}

        {sessionId !== null && (
          // 浏览器里 safe-area 为 0，用 0.5rem 兜底不贴边；standalone 下取
          // home indicator 的实际高度，不再叠加，避免下方留出多余空白
          <div className="phone-dock phone-code-dock @container shrink-0 pt-2 pb-safe">
            <div className={CHAT_COL}>
              {/* 自动重试横幅：只展示不可取消（pair 桥无 abort-retry 通道，整轮 abort 已够用） */}
              {view?.retry && <RetryBar retry={view.retry} />}
              {/* 排队区：复用桌面组件，编辑/删除/立即发送/打断并发送经桩发 pair 命令 */}
              {!readOnly && (
                <MessageQueue
                  conversationId={sessionId}
                  queued={(props.queued ?? []).map((q) => ({ id: q.id, text: q.text }))}
                />
              )}
              {bot?.outbox}
              {(props.notice || bot?.notice) && (
                <p className="mb-1 rounded-[14px] bg-red/8 px-3 py-2 text-[12px] leading-4 text-red">
                  {props.notice || bot?.notice}
                </p>
              )}
              {!props.deviceReadOnly && (
                <>
                  <ApprovalBar
                    appearance="phone"
                    approvals={view?.approvals ?? []}
                    onRespond={props.onApproval}
                    clockOffset={props.clockOffset}
                  />
                  <AskBar
                    appearance="phone"
                    asks={view?.asks ?? []}
                    onAnswer={props.onAsk}
                    clockOffset={props.clockOffset}
                    autoFocus={false}
                  />
                </>
              )}
              {readOnly ? (
                // 只读设备不渲染真 Composer（写操作在 optimistic echo 前就拒绝），
                // 但按设计稿保留一条灰掉的输入条，让"不能发"是可见的而不是凭空消失
                <div className="relative shrink-0">
                  <div className="flex items-end gap-2">
                    <div className="flex h-12 flex-1 items-center rounded-3xl border border-line bg-card2 px-4">
                      <span className="text-[16px] leading-[22px] text-faint">
                        只读设备，不能发送
                      </span>
                    </div>
                    <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-card2 text-faint">
                      <ArrowUp className="size-[22px]" aria-hidden />
                    </span>
                  </div>
                </div>
              ) : !pendingInput ? (
                <Composer
                  appearance="phone"
                  placeholder={bot ? `向 ${props.title} 提问…` : '回复 CodeKiln…'}
                  commands={slashCommands}
                  running={running}
                  busy={running}
                  locked={
                    props.newSessionBusy ||
                    (Boolean(bot) && sending) ||
                    (view?.approvals ?? []).length > 0
                  }
                  focusKey={bot?.chatId ? `bot-chat:${bot.chatId}` : sessionId}
                  // 移动端不自动聚焦：一进会话就弹键盘会挡住消息
                  autoFocus={false}
                  // 软键盘的「换行」就是 Enter：Enter 只换行，发送必须点按钮
                  enterToSend={false}
                  onSend={(payload) => {
                    // 手机端不支持 @mention 派发，只取文本与图片
                    void send(payload.text, payload.images);
                    return undefined;
                  }}
                  onAbort={props.onAbort}
                  voice={props.voice}
                  voiceMode="hold"
                />
              ) : null}
              {!readOnly && !pendingInput && (
                <SessionStatsLine usageTotals={props.usageTotals} context={props.context} />
              )}
            </div>
          </div>
        )}
        <ConversationMenu
          open={menuOpen}
          title="会话"
          onClose={() => setMenuOpen(false)}
          items={[
            {
              key: 'new-session',
              label: '开新会话',
              hint: bot ? '清掉这段上下文，开始新一轮对话' : '选一个项目，开始新的工作',
              icon: 'new-session',
              danger: Boolean(bot),
              disabled:
                !props.canCreate ||
                readOnly ||
                (Boolean(bot) && sending) ||
                props.connState !== 'online',
              disabledHint: props.newSessionHint,
              onSelect: () => {
                setMenuOpen(false);
                props.onNewSession();
              },
            },
          ]}
          footer={
            <>
              {sessionId && !bot && (
                <div className="mb-3 flex flex-wrap gap-2">
                  <FileDownloads target={{ sessionId }}>文件下载</FileDownloads>
                  <WebPreview target={{ sessionId }}>网页预览</WebPreview>
                </div>
              )}
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="h-12 w-full rounded-full bg-card2 text-[15px] font-medium text-ink2"
              >
                取消
              </button>
            </>
          }
        />
      </div>
    </ChatHostContext.Provider>
  );
}

/** 与桌面 CoworkerTabs 的 tabClass 同款 */
function tabClass(active: boolean): string {
  return cn(
    't-tab flex h-8 min-w-0 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] leading-4 font-medium transition-colors',
    active ? 'text-pill-ink' : 'bg-card2 text-ink2'
  );
}

/** 顶栏副行：项目 · 模型。空段自动略过，全空时由调用方回落到连接状态文案。 */
export function subjectLine(projectName: string, modelLabel?: string): string {
  return [projectName, modelLabel].filter((part) => Boolean(part?.trim())).join(' · ');
}

/** Composer 已把图片读成 base64，这里只在超出本张预算（整帧按张数均分）时再压一轮 */
async function compressImageIfNeeded(image: AttachedImage, budget: number): Promise<AttachedImage> {
  if (image.data.length * 0.75 <= budget) return image;
  const blob = await (await fetch(`data:${image.mimeType};base64,${image.data}`)).blob();
  return compressWithin(new File([blob], 'image', { type: image.mimeType }), budget);
}
