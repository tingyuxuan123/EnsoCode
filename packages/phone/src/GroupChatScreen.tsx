import type {
  AttachedImage,
  PairBotActivity,
  PairBotChatState,
  PairBotChatSummary,
  PairBotMember,
  PairDelegationState,
  PairGroupEntry,
} from '@enso/pair';
import { retryableGroupFailures } from '@shared/bots/groupRetry';
import { splitTaskRef } from '@shared/bots/progress';
import type { StartVoiceSession } from '@shared/types/speech';
import {
  ArrowUp,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CirclePlay,
  EllipsisVertical,
  ImagePlus,
  Loader2,
  Square,
  X,
} from 'lucide-react';
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ApprovalBar } from '@/components/chat/ApprovalBar';
import { AskBar } from '@/components/chat/AskBar';
import { Markdown } from '@/components/chat/Markdown';
import { VoiceInputButton } from '@/components/chat/VoiceInputButton';
import { cn } from '@/lib/utils';
import { BotActivityRow } from './BotActivityRow';
import { BotArtifacts } from './BotArtifacts';
import { BotAvatar } from './BotAvatar';
import {
  activeMention,
  type GroupTimelineState,
  insertMention,
  type MentionOption,
  mentionOptions,
  visibleGroupEntries,
} from './botState';
import { ActivityRow, SayHead, SegmentLead } from './ChatRows';
import { ConversationMenu, type ConversationMenuItem } from './ConversationMenu';
import type { ConnState, SessionView } from './client';
import { GroupThreadSwitcher, type GroupThreads } from './GroupThreadSwitcher';
import { groupRows } from './groupRows';
import { compressImages } from './image';
import { PhoneTopBar, TopBarAction } from './PhoneTopBar';
import { readOnlyBanner } from './readOnly';
import { WebPreview } from './WebPreview';

export interface MemberPending {
  sessionId: string;
  botId: string;
  view: SessionView;
}

interface Props {
  chat: PairBotChatSummary;
  bots: ReadonlyMap<string, PairBotMember>;
  timeline: GroupTimelineState | undefined;
  state: PairBotChatState | undefined;
  pending: MemberPending[];
  /** 本群成员（含委派子会话）的实时运行态 */
  activities: PairBotActivity[];
  clockOffset: number;
  connState: ConnState;
  stateLabel: string;
  notice: string | null;
  /** 离线待发队列；有它时断线也可发送（先入队，连上后重发） */
  outbox?: ReactNode;
  /** 桌面把本设备设为只读：只能看时间线 */
  deviceReadOnly?: boolean;
  /** 有写操作刚被桌面以只读拦下 */
  readOnlyRejected?: boolean;
  onOpenDrawer(): void;
  onNewSession?(): void;
  canCreate?: boolean;
  newSessionHint?: string;
  newSessionBusy?: boolean;
  /** 桌面支持群话题时提供；旧桌面缺省，保持「新建会话」 */
  threads?: GroupThreads;
  /** 大屏横屏侧栏已常驻：左上不再显示抽屉入口 */
  drawerDocked?: boolean;
  onLoadOlder(): void;
  onJumpLatest?(): void;
  historyLoading?: boolean;
  onSend(text: string, images: AttachedImage[]): void;
  onStop(): void;
  onRetry?(entryId: string): void;
  onOpenProcess(conversationId: string): void;
  /** 会话菜单里的「通信空间」：上来只看本群的委派来去（只读） */
  onOpenComms?(): void;
  /** 桌面语音识别可用时由 App 下发：输入框左侧显示麦克风 */
  voice?: StartVoiceSession;
  onApproval(
    sessionId: string,
    requestId: string,
    decision: 'allow' | 'allowSession' | 'deny'
  ): void;
  onAsk(sessionId: string, requestId: string, answer: string): void;
}

const DELEGATION_TEXT: Record<PairDelegationState, string> = {
  queued: '排队中',
  running: '进行中',
  completed: '已完成',
  failed: '失败',
  canceled: '已取消',
  blocked: '卡住了',
};

/** 一条群消息最多带几张图（整帧要压进中继 1MB 上限） */
const MAX_IMAGES = 4;

const timeOf = (at: number): string =>
  new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const PROGRESS_TONE = {
  started: { icon: CirclePlay, className: 'border-brand/50 text-brand' },
  blocked: { icon: CircleAlert, className: 'border-warning/60 text-warning' },
  delivered: { icon: CircleCheck, className: 'border-success/60 text-success' },
} as const;

type DelegationEntry = Extract<PairGroupEntry, { kind: 'delegation' }>;

/** 委派结果卡；挂了任务的群里已有进度行，结果默认折叠，点开看 */
function DelegationRow({
  entry,
  bots,
}: {
  entry: DelegationEntry;
  bots: ReadonlyMap<string, PairBotMember>;
}) {
  const collapsible = Boolean(entry.taskId);
  const [open, setOpen] = useState(!collapsible);
  const head = (
    <>
      {collapsible && (
        <ChevronRight
          aria-hidden
          className={cn('h-3 w-3 shrink-0 transition-transform', open && 'rotate-90')}
        />
      )}
      <span className="font-medium">
        {bots.get(entry.from)?.name ?? '成员'} → {bots.get(entry.to)?.name ?? '成员'}
      </span>
      <span
        className={cn(
          'rounded px-1.5 py-0.5',
          entry.state === 'running' || entry.state === 'queued'
            ? 'bg-brand/10 text-brand'
            : entry.state === 'failed'
              ? 'bg-destructive/10 text-destructive'
              : 'bg-muted text-muted-foreground'
        )}
      >
        {DELEGATION_TEXT[entry.state]}
      </span>
    </>
  );
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
      {collapsible ? (
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? '收起委派结果' : '展开委派结果'}
          className="flex w-full items-center gap-1.5 text-left"
          onClick={() => setOpen((value) => !value)}
        >
          {head}
        </button>
      ) : (
        <p className="flex items-center gap-1.5">{head}</p>
      )}
      {open && entry.summary && (
        <p className="mt-1 line-clamp-3 text-muted-foreground">{entry.summary}</p>
      )}
    </div>
  );
}

/** 已知成员名的 @提及高亮 */
function withMentions(text: string, names: readonly string[]): ReactNode[] {
  const sorted = [...names].sort((a, b) => b.length - a.length);
  const out: ReactNode[] = [];
  let rest = text;
  let key = 0;
  while (rest) {
    const at = rest.indexOf('@');
    const name = at < 0 ? undefined : sorted.find((n) => rest.startsWith(n, at + 1));
    if (at < 0 || !name) {
      out.push(rest);
      break;
    }
    if (at > 0) out.push(rest.slice(0, at));
    out.push(
      <span key={key++} className="font-medium text-brand">
        @{name}
      </span>
    );
    rest = rest.slice(at + 1 + name.length);
  }
  return out;
}

/** 群聊：时间线 + @ 补全输入框；成员会话过程按需只读查看 */
export function GroupChatScreen(props: Props) {
  const { chat, bots, timeline, state } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const anchorRef = useRef<{ height: number; top: number } | null>(null);
  const stickRef = useRef(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('');
  const [caret, setCaret] = useState(0);
  const [picked, setPicked] = useState<{ file: File; url: string }[]>([]);
  const [sending, setSending] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const loaded = timeline?.entries ?? [];
  const epoch =
    chat.epochSeq ??
    loaded.findLast((entry) => entry.kind === 'system' && entry.newConversation)?.seq ??
    0;
  const [expanded, setExpanded] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 新聊天 / 新段重新折叠
  useEffect(() => setExpanded(false), [chat.id, epoch]);
  const folded = epoch > 0 && !expanded;
  const entries = visibleGroupEntries(loaded, epoch, expanded);
  // 分层：一轮只留结论，过程折成一行活动行，段头给时间和「N 条消息，与 M 个 Bot」
  const rows = useMemo(() => groupRows(entries, bots, Date.now()), [entries, bots]);
  /** 点开活动行的那几轮：展开才渲染委派与进度细节 */
  const [openTurns, setOpenTurns] = useState<Record<string, boolean>>({});
  const retryable = retryableGroupFailures(loaded, epoch);
  const members = chat.members
    .map((id) => bots.get(id))
    .filter((bot): bot is PairBotMember => Boolean(bot && !bot.archived));
  const names = members.map((bot) => bot.name);
  const running = Boolean(state?.current) || chat.status !== 'idle';
  const mention = activeMention(text, caret);
  const options: MentionOption[] = mention ? mentionOptions(mention.query, members) : [];
  const firstSeq = entries[0]?.seq;
  const lastSeq = entries.at(-1)?.seq;

  // 旧页插到顶部后补偿 scrollTop；新条目到达时若原本贴底则跟随
  // biome-ignore lint/correctness/useExhaustiveDependencies: 首末 seq 变化即为触发信号
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const anchor = anchorRef.current;
    if (anchor) {
      anchorRef.current = null;
      el.scrollTop = anchor.top + (el.scrollHeight - anchor.height);
    } else if (stickRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [firstSeq, lastSeq, state?.current, props.activities.length]);

  const loadOlder = () => {
    const el = scrollRef.current;
    if (
      !timeline?.hasOlder ||
      !el ||
      props.historyLoading ||
      props.connState !== 'online' ||
      (folded && (loaded[0]?.seq ?? epoch) <= epoch)
    )
      return;
    anchorRef.current = { height: el.scrollHeight, top: el.scrollTop };
    props.onLoadOlder();
  };

  const pick = (option: MentionOption) => {
    if (!mention) return;
    const next = insertMention(text, mention, caret, option.name);
    setText(next.text);
    setCaret(next.caret);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(next.caret, next.caret);
    });
  };

  const pickedRef = useRef(picked);
  pickedRef.current = picked;
  useEffect(
    () => () => {
      for (const item of pickedRef.current) URL.revokeObjectURL(item.url);
    },
    []
  );

  const pickFiles = (files: FileList | null) => {
    const next = [...(files ?? [])]
      .filter((file) => file.type.startsWith('image/'))
      .slice(0, MAX_IMAGES - picked.length)
      .map((file) => ({ file, url: URL.createObjectURL(file) }));
    setPicked((current) => [...current, ...next]);
    setImageError(null);
  };

  const unpick = (url: string) => {
    URL.revokeObjectURL(url);
    setPicked((current) => current.filter((item) => item.url !== url));
  };

  const submit = async () => {
    if ((!text.trim() && picked.length === 0) || sending || props.newSessionBusy) return;
    let images: AttachedImage[] = [];
    if (picked.length) {
      setSending(true);
      try {
        images = await compressImages(picked.map((item) => item.file));
      } catch (error) {
        setImageError(error instanceof Error ? error.message : '图片处理失败');
        return;
      } finally {
        setSending(false);
      }
    }
    props.onSend(text, images);
    for (const item of picked) URL.revokeObjectURL(item.url);
    setPicked([]);
    setImageError(null);
    setText('');
    setCaret(0);
    stickRef.current = true;
  };

  /** 识别结果插到光标处；焦点不在输入框时追加到末尾 */
  const insertVoiceText = (value: string) => {
    const el = inputRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + value + text.slice(end);
    setText(next);
    setCaret(start + value.length);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + value.length, start + value.length);
    });
  };

  /** 过程细节：只有点开活动行时才渲染（L3 的展开层） */
  const renderDetail = (entry: PairGroupEntry) => {
    switch (entry.kind) {
      case 'delegation':
        return <DelegationRow key={entry.seq} entry={entry} bots={bots} />;
      case 'progress': {
        const bot = bots.get(entry.botId);
        const tone = PROGRESS_TONE[entry.phase];
        const Icon = tone.icon;
        const ref = splitTaskRef(entry.text, entry.taskSeq);
        return (
          <div key={entry.seq} data-phase={entry.phase} className="flex gap-2 text-xs">
            <BotAvatar bot={bot} size="sm" />
            <div
              className={cn(
                'flex min-w-0 items-start gap-1.5 rounded-md border-l-2 bg-muted/50 px-2 py-1',
                tone.className
              )}
            >
              <Icon aria-hidden className="mt-px h-3.5 w-3.5 shrink-0" />
              <p className="line-clamp-2 min-w-0 break-words text-muted-foreground">
                <span className="font-medium text-foreground">{bot?.name ?? '成员'}</span>{' '}
                {ref ? (
                  <>
                    {withMentions(ref[0], names)}
                    <span className="font-medium text-foreground">{ref[1]}</span>
                    {withMentions(ref[2], names)}
                  </>
                ) : (
                  withMentions(entry.text, names)
                )}
              </p>
            </div>
          </div>
        );
      }
      default:
        return null;
    }
  };

  /** 一条分层行：段头 / 人说的话 / 一轮的结论 / 系统信息 */
  const renderRow = (row: (typeof rows)[number]) => {
    if (row.kind === 'lead') return <SegmentLead key={row.key}>{row.label}</SegmentLead>;
    if (row.kind === 'human') {
      const entry = row.entry;
      return (
        <div key={row.key} className="flex flex-col items-end">
          {entry.text && (
            <div className="max-w-[86%] whitespace-pre-wrap break-words rounded-[20px] rounded-br-md bg-pill px-4 py-3 text-[16px] leading-[22px] text-pill-ink">
              {withMentions(entry.text, names)}
              {entry.truncated && (
                <p className="text-[11px] leading-4 opacity-70">消息过长，仅显示部分内容</p>
              )}
            </div>
          )}
          {entry.images?.length ? (
            <BotArtifacts target={{ chatId: props.chat.id, entryId: entry.id }} />
          ) : null}
        </div>
      );
    }
    if (row.kind === 'system') {
      const entry = row.entry;
      return (
        <p key={row.key} className="text-center text-[12px] leading-4 text-dim">
          {entry.text}
          {retryable.has(entry.id) && props.onRetry && !props.deviceReadOnly && (
            <button
              type="button"
              className="ml-2 underline disabled:opacity-50"
              disabled={running || props.connState !== 'online'}
              onClick={() => props.onRetry?.(entry.id)}
            >
              重试
            </button>
          )}
        </p>
      );
    }
    const bot = bots.get(row.botId);
    const open = openTurns[row.key] === true;
    return (
      <article key={row.key} className="flex flex-col gap-2 pb-4">
        <SayHead name={row.name} bot={bot} time={timeOf(row.at)} />
        <div className="min-w-0 text-[15px] leading-6">
          <Markdown text={row.text} />
          {row.folded.some((entry) => entry.truncated) && (
            <p className="text-[11px] leading-4 text-dim">消息过长，仅显示部分内容</p>
          )}
        </div>
        {row.activity && (
          <ActivityRow
            activity={row.activity}
            live={row.activity.live}
            onOpen={
              row.folded.length > 0
                ? () => setOpenTurns((prev) => ({ ...prev, [row.key]: !open }))
                : undefined
            }
          />
        )}
        {open && <div className="flex flex-col gap-1.5">{row.folded.map(renderDetail)}</div>}
        <BotArtifacts target={{ chatId: props.chat.id, entryId: row.entryId }} />
        <div>
          <WebPreview target={{ bot: { chatId: props.chat.id, entryId: row.entryId } }}>
            网页预览
          </WebPreview>
        </div>
        <button
          type="button"
          onClick={() => props.onOpenProcess(row.conversationId)}
          className="flex items-center gap-0.5 self-start text-[12px] leading-4 text-dim"
        >
          <ChevronRight className="size-3" aria-hidden />
          查看过程
        </button>
      </article>
    );
  };

  const current = state?.current ? bots.get(state.current) : undefined;

  // 会话菜单（设计稿 `bot-menu.tsx`）：开新会话是破坏性的，行内写明后果；
  // 新线程走桌面下发的 threads；离线/只读时逐个禁用并给出原因。
  const menuItems = (): ConversationMenuItem[] => {
    const offline = props.connState !== 'online';
    const readOnlyHint = props.deviceReadOnly ? '此设备为只读' : undefined;
    const blocked = readOnlyHint ?? (offline ? props.stateLabel : undefined);
    const items: ConversationMenuItem[] = [];
    if (!props.threads) {
      items.push({
        key: 'new-session',
        label: '开新会话',
        hint: '清掉这段上下文，从这个群重新开始',
        icon: 'new-session',
        danger: true,
        disabled: Boolean(blocked) || !props.canCreate,
        disabledHint: blocked ?? '桌面端不支持新建会话',
        onSelect: () => {
          props.onNewSession?.();
          setMenuOpen(false);
        },
      });
    }
    if (props.threads) {
      items.push({
        key: 'thread',
        label: '新话题',
        hint: '在这段对话里另起一条线索',
        icon: 'thread',
        disabled: Boolean(props.threads.disabledHint),
        disabledHint: props.threads.disabledHint,
        onSelect: () => {
          props.threads?.onCreate();
          setMenuOpen(false);
        },
      });
    }
    if (props.onOpenComms) {
      items.push({
        key: 'comms',
        label: '通信空间',
        hint: 'Bot 之间的来去，只读',
        icon: 'comms',
        onSelect: () => {
          props.onOpenComms?.();
          setMenuOpen(false);
        },
      });
    }
    return items;
  };

  return (
    <div className="phone-chat-root flex h-full min-h-0 flex-col">
      <PhoneTopBar
        lead={props.drawerDocked ? 'none' : 'menu'}
        {...(props.drawerDocked ? {} : { onLead: props.onOpenDrawer })}
        title={chat.title || '群聊'}
        detail={
          props.threads ? (
            <GroupThreadSwitcher
              threads={props.threads}
              status={props.connState === 'online' ? undefined : props.stateLabel}
            />
          ) : props.connState === 'online' ? (
            `${chat.members.length} 位成员`
          ) : (
            props.stateLabel
          )
        }
      >
        {/* 一个会话只有一个入口（设计稿 bot-menu）：新建会话 / 新话题 / 通信空间都收进 ⋯ */}
        <TopBarAction label="会话菜单" onClick={() => setMenuOpen(true)}>
          <EllipsisVertical className="size-6" aria-hidden />
        </TopBarAction>
      </PhoneTopBar>

      <div
        ref={scrollRef}
        onScroll={(event) => {
          const el = event.currentTarget;
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          if (el.scrollTop < 60) loadOlder();
        }}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3"
      >
        {timeline === undefined ? (
          <p className="flex items-center justify-center gap-1.5 py-8 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            读取中…
          </p>
        ) : timeline.hasOlder && (!folded || (loaded[0]?.seq ?? epoch) > epoch) ? (
          <button
            type="button"
            onClick={loadOlder}
            disabled={props.historyLoading || props.connState !== 'online'}
            className="w-full py-1 text-center text-muted-foreground text-xs"
          >
            {props.historyLoading ? '加载中…' : '加载更早的消息'}
          </button>
        ) : entries.length === 0 ? (
          <p className="py-8 text-center text-muted-foreground text-sm">
            @ 成员开始对话，未 @ 时由群主回复
          </p>
        ) : null}
        {epoch > 0 && (
          <button
            type="button"
            className="w-full py-1 text-center text-muted-foreground text-xs"
            onClick={() => {
              setExpanded(!expanded);
              if (expanded && timeline?.history) props.onJumpLatest?.();
              else if (
                !expanded &&
                timeline?.hasOlder &&
                !loaded.some((entry) => entry.seq < epoch)
              )
                props.onLoadOlder();
            }}
          >
            {folded ? `更早的对话 · ${epoch - 1} 条` : '收起更早的对话'}
          </button>
        )}
        {timeline?.history && (
          <button
            type="button"
            className="w-full py-1 text-center text-brand text-xs"
            onClick={() => {
              stickRef.current = true;
              props.onJumpLatest?.();
            }}
          >
            回到最新消息
          </button>
        )}
        {rows.map(renderRow)}
        {props.activities.map((item) => (
          <BotActivityRow
            key={item.conversationId}
            item={item}
            bots={bots}
            clockOffset={props.clockOffset}
            onOpen={props.onOpenProcess}
          />
        ))}
        {current && props.activities.length === 0 && (
          <div className="flex items-center gap-2">
            <BotAvatar bot={current} size="sm" busy />
            <span className="text-muted-foreground text-xs">{current.name} 正在回复…</span>
          </div>
        )}
      </div>

      <div className="phone-dock shrink-0 space-y-2 border-t px-3 pt-2 pb-safe">
        {props.outbox}
        {props.notice && (
          <p className="rounded-md bg-destructive/10 px-2 py-1 text-destructive text-xs">
            {props.notice}
          </p>
        )}
        {props.deviceReadOnly && (
          <p className="rounded-md bg-muted px-2 py-1 text-center text-muted-foreground text-xs">
            {readOnlyBanner(props.readOnlyRejected)}
          </p>
        )}
        {!props.deviceReadOnly &&
          props.pending.map(({ sessionId, botId, view }) =>
            view.approvals.length > 0 || view.asks.length > 0 ? (
              <div key={sessionId} className="space-y-1">
                <p className="text-muted-foreground text-xs">{bots.get(botId)?.name ?? '成员'}</p>
                <ApprovalBar
                  approvals={view.approvals}
                  clockOffset={props.clockOffset}
                  onRespond={(requestId, decision) =>
                    props.onApproval(sessionId, requestId, decision)
                  }
                />
                <AskBar
                  asks={view.asks}
                  clockOffset={props.clockOffset}
                  onAnswer={(requestId, answer) => props.onAsk(sessionId, requestId, answer)}
                  autoFocus={false}
                />
              </div>
            ) : null
          )}
        <div className={cn('relative', props.deviceReadOnly && 'hidden')}>
          {options.length > 0 && (
            <div className="absolute right-0 bottom-full left-0 mb-1 max-h-48 overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
              {options.map((option) => {
                const bot = bots.get(option.id);
                return (
                  <button
                    key={option.id}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => pick(option)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                  >
                    {bot ? (
                      <BotAvatar bot={bot} size="sm" />
                    ) : (
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs">
                        @
                      </span>
                    )}
                    <span className="font-medium">{option.name}</span>
                    {bot?.title && (
                      <span className="truncate text-muted-foreground text-xs">{bot.title}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          {imageError && <p className="mb-1 text-destructive text-xs">{imageError}</p>}
          {picked.length > 0 && (
            <div className="mb-1.5 flex gap-1.5">
              {picked.map((item) => (
                <div
                  key={item.url}
                  className="relative h-14 w-14 overflow-hidden rounded-md border"
                >
                  <img src={item.url} alt="" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    aria-label="移除图片"
                    onClick={() => unpick(item.url)}
                    className="absolute top-0.5 right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/60 text-white"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div
            ref={composerRef}
            className="flex items-end gap-2 rounded-md border bg-background px-2 py-1.5 focus-within:border-brand/60"
          >
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(event) => {
                pickFiles(event.target.files);
                event.target.value = '';
              }}
            />
            <button
              type="button"
              aria-label="添加图片"
              disabled={picked.length >= MAX_IMAGES}
              onClick={() => fileRef.current?.click()}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground disabled:opacity-40"
            >
              <ImagePlus className="h-4.5 w-4.5" />
            </button>
            {props.voice && (
              // 录音中按钮展开成电平条＋停止＋取消，宽度自适应，不固定 8 宽以免压住输入框
              <span className="flex h-8 shrink-0 items-center justify-center [&>div>button]:h-8 [&>div>button]:min-w-8 [&>div>button]:rounded-full">
                <VoiceInputButton
                  startSession={props.voice}
                  disabled={sending}
                  holdScope={composerRef}
                  onText={insertVoiceText}
                />
              </span>
            )}
            <textarea
              ref={inputRef}
              rows={1}
              value={text}
              placeholder="@ 成员，或直接说…"
              onChange={(event) => {
                setText(event.target.value);
                setCaret(event.target.selectionStart ?? event.target.value.length);
              }}
              onSelect={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
              className="max-h-32 min-h-6 flex-1 resize-none bg-transparent text-sm outline-none field-sizing-content"
            />
            {running && (
              <button
                type="button"
                aria-label="停止"
                data-composer-action="stop"
                onClick={props.onStop}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-foreground"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
              </button>
            )}
            <button
              type="button"
              aria-label="发送"
              data-composer-action="send"
              disabled={
                (!text.trim() && picked.length === 0) ||
                sending ||
                props.newSessionBusy ||
                (!props.outbox && props.connState !== 'online')
              }
              onClick={() => void submit()}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-brand-foreground disabled:opacity-40"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
      <ConversationMenu
        open={menuOpen}
        title="会话"
        aside={<span className="text-[12px] leading-4 text-dim">{chat.members.length} 名成员</span>}
        items={menuItems()}
        onClose={() => setMenuOpen(false)}
      />
    </div>
  );
}
