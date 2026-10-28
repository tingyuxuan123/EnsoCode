import { splitChatReferences } from '@shared/bots/composerRefs';
import { parseBotInjectedMessage } from '@shared/bots/injectedMessage';
import { stripBotNotesUpdate } from '@shared/bots/notes';
import { isBtwIsolationPrompt } from '@shared/btw';
import { toLocalImageUrl } from '@shared/localImage';
import { type PlanNoteKind, parsePlanMessage, splitPlanPrefix } from '@shared/planMode';
import type {
  AgentRunProgress,
  AgentSessionCustomEntry,
  TodoItem,
  TurnPerf,
} from '@shared/types/agent';
import { parseWorkflowPresetMessage } from '@shared/workflowPresetMessage';
import {
  ArrowDownToLine,
  Bot,
  BoxSelect,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  ClipboardCheck,
  ClipboardList,
  Copy,
  FilePlus,
  FileText,
  FolderOpen,
  FoldVertical,
  GitBranch,
  GitCompare,
  Globe,
  History,
  ListTodo,
  LoaderCircle,
  type LucideIcon,
  MessagesSquare,
  PackageMinus,
  Pencil,
  RefreshCw,
  Search,
  SkipForward,
  Sparkles,
  Target,
  TerminalSquare,
  Undo2,
  Workflow,
  Wrench,
} from 'lucide-react';
import {
  memo,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { InjectedMessageCard } from '@/components/bots/InjectedMessageCard';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogPanel,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Popover, PopoverPopup, PopoverTrigger } from '@/components/ui/popover';
import { useOauthAccountEmails } from '@/hooks/useOauthAccountEmails';
import { useSubagentProcess } from '@/hooks/useSubagentProcess';
import { type TFunction, useI18n } from '@/i18n';
import { diffCacheKey } from '@/lib/diffCacheKey';
import { parseMcpToolName } from '@/lib/mcpToolName';
import { addSidePanelChanges } from '@/lib/sidePanelDock';
import { stripAnsi } from '@/lib/terminalText';
import { SUBAGENT_OP_LABEL_KEYS, TOOL_LABEL_KEYS, toolLabel } from '@/lib/toolLabels';
import { cn } from '@/lib/utils';
import { useSessionsStore } from '@/stores/sessions';
import {
  canShowConversationFork,
  canShowConversationRewind,
  resolveRewindConfirm,
  userIndexFromEndForTurnKey,
} from '@/stores/sessions/conversationRewind';
import { canWithdrawMessage } from '@/stores/sessions/reducer';
import { formatDuration, formatTokens } from '@/stores/sessions/stats';
import {
  exploreStepsKey,
  isReadOnlyTool,
  isSandboxTool,
  type SandboxView,
  shouldAutoExpandAppliedFileChanges,
  shouldShowToolOutputAfterFileChanges,
  summarizeSandboxCalls,
  type TimelineItem,
  thinkingRowExpanded,
} from '@/stores/sessions/timeline';
import { useSettingsStore } from '@/stores/settings';
import { useSubagentRunsStore } from '@/stores/subagentRuns';
import { AskUserResult } from './AskUserResult';
import { CodeBlock } from './CodeBlock';
import { ConfirmDialog } from './ConfirmDialog';
import { ChatSessionContext, useChatHost } from './chatHost';
import { EditDiff } from './EditDiff';
import { EnsoMark } from './EnsoMark';
import { DiffCount } from './FlipMetricValue';
import { renderHighlighted, useChatSearchHighlight } from './highlightQuery';
import { Markdown } from './Markdown';
import { MemoryCaptureResult, MemorySearchResults } from './MemorySearchResults';
import { mentionChipClass } from './MentionChip';
import { parseMemoryCapture, parseMemorySearchHits } from './memorySearchHits';
import { splitInlineMentions, splitMentionRefs } from './mentionComposer';
import { ReadFileView } from './ReadFileView';
import { RtkToolStatsBar } from './RtkToolStatsBar';
import { SlashChip, slashChipClass, splitSlashCommand } from './SlashChip';
import { SubagentResult } from './SubagentResult';
import { parseSubagentReceipt } from './subagentReceipt';
import { TerminalOutput } from './TerminalOutput';
import { TodoList } from './TodoBar';
import { ToolSummaryRow } from './ToolSummaryRow';
import { TurnFilesFooter } from './TurnFilesCard';
import { toolLineDelta } from './toolLineDelta';
import { shouldCollapseUserQuery, USER_QUERY_MAX_HEIGHT } from './userQueryCollapse';
import { ZoomableImage } from './ZoomableImage';

const perfEqual = (a?: TurnPerf, b?: TurnPerf): boolean =>
  a === b ||
  (!!a &&
    !!b &&
    a.runMs === b.runMs &&
    a.turnMs === b.turnMs &&
    a.ttftMs === b.ttftMs &&
    a.tps === b.tps);

interface TimelineRowProps {
  item: TimelineItem;
  /** tool-group 组头点击展开/收拢 */
  onToggleGroup?: (key: string) => void;
  /** 轮次（Turn）折叠/展开：行自身知道目标状态，父级不必回查 */
  onToggleTurn?: (key: string, collapsed: boolean) => void;
}

/**
 * 按内容字段比较：buildTimeline 每次产出新 item 对象，直接 memo 无效。
 * 长对话下这层比较挡住了未变行的 markdown 重解析与 DOM 重建。
 * onToggleGroup 引用不参与比较（父级保证语义稳定）。
 */
function itemEqual(prev: TimelineRowProps, next: TimelineRowProps): boolean {
  const a = prev.item;
  const b = next.item;
  if (a === b) return true;
  if (a.kind !== b.kind || a.key !== b.key) return false;
  switch (a.kind) {
    case 'user': {
      if (b.kind !== 'user') return false;
      if (
        a.text !== b.text ||
        a.images.length !== b.images.length ||
        a.timestamp !== b.timestamp ||
        a.deliveryState !== b.deliveryState ||
        a.turnDurationMs !== b.turnDurationMs ||
        a.turnStatus !== b.turnStatus ||
        a.collapsed !== b.collapsed ||
        a.canCollapse !== b.canCollapse
      )
        return false;
      return a.images.every((image, i) => image === b.images[i]);
    }
    case 'text':
    case 'thinking':
      return (
        b.kind === a.kind &&
        a.text === b.text &&
        a.streaming === b.streaming &&
        (a.kind !== 'thinking' || (b.kind === 'thinking' && a.nested === b.nested)) &&
        (a.kind !== 'text' ||
          (b.kind === 'text' &&
            perfEqual(a.perf, b.perf) &&
            a.timestamp === b.timestamp &&
            a.turnDurationMs === b.turnDurationMs)) &&
        (a.kind !== 'thinking' || (b.kind === 'thinking' && a.durationMs === b.durationMs))
      );
    case 'tool':
      return (
        b.kind === 'tool' &&
        a.state === b.state &&
        a.name === b.name &&
        a.nested === b.nested &&
        a.summary === b.summary &&
        a.output === b.output &&
        a.edits === b.edits &&
        a.writeContent === b.writeContent &&
        a.fileChanges === b.fileChanges &&
        a.imagePath === b.imagePath &&
        a.todos === b.todos &&
        a.durationMs === b.durationMs &&
        a.startedAt === b.startedAt &&
        a.agentMeta === b.agentMeta &&
        a.source === b.source &&
        a.nestedPending === b.nestedPending &&
        JSON.stringify(a.sandbox) === JSON.stringify(b.sandbox) &&
        a.rtk === b.rtk &&
        a.plan?.title === b.plan?.title &&
        a.plan?.text === b.plan?.text &&
        a.sentMessage === b.sentMessage &&
        a.memoryContent === b.memoryContent &&
        a.ask?.question === b.ask?.question &&
        a.ask?.options.join('\n') === b.ask?.options.join('\n') &&
        a.ask?.answer === b.ask?.answer &&
        a.ask?.autoSelected === b.ask?.autoSelected &&
        a.subagentOp === b.subagentOp &&
        a.subagentAgentIds?.join('\0') === b.subagentAgentIds?.join('\0') &&
        JSON.stringify(a.subagentTitles) === JSON.stringify(b.subagentTitles) &&
        a.waiting === b.waiting
      );
    case 'tool-group':
      return (
        b.kind === 'tool-group' &&
        a.expanded === b.expanded &&
        a.count === b.count &&
        a.stats.commands === b.stats.commands &&
        a.stats.reads === b.stats.reads &&
        a.stats.searches === b.stats.searches &&
        a.stats.others === b.stats.others &&
        a.exploring === b.exploring &&
        a.worklog?.status === b.worklog?.status &&
        a.worklog?.forced === b.worklog?.forced &&
        a.worklog?.durationMs === b.worklog?.durationMs &&
        a.worklog?.startedAt === b.worklog?.startedAt &&
        a.worklog?.thinking === b.worklog?.thinking &&
        a.worklog?.failed === b.worklog?.failed &&
        a.explore?.goal === b.explore?.goal &&
        a.explore?.report === b.explore?.report &&
        a.explore?.steps === b.explore?.steps
      );
    case 'error':
      return b.kind === 'error' && a.text === b.text;
    case 'task-note':
      return b.kind === 'task-note' && a.detail === b.detail;
    case 'compaction':
    case 'compaction-notice':
      return (
        (b.kind === 'compaction' || b.kind === 'compaction-notice') &&
        a.kind === b.kind &&
        a.summary === b.summary &&
        a.tokensBefore === b.tokensBefore &&
        a.verified === b.verified
      );
    case 'compaction-progress':
      return b.kind === 'compaction-progress' && a.state === b.state;
    case 'session-custom':
      return b.kind === 'session-custom' && a.entry === b.entry;
    case 'divider':
      return b.kind === 'divider' && a.text === b.text;
  }
}

/** 系统合成的整块注入消息（coworker 雇佣通知 / 后台任务提醒） */
const SYNTHETIC_BLOCK =
  /^<(agent-notification|goal-continuation|coworker-hired|coworker-dismissed|background-task-update)>\n?([\s\S]*?)\n?<\/\1>\s*$/;
/** coworker 首条的角色前缀 */
const ROLE_PREFIX = /^<role>\n?([\s\S]*?)\n?<\/role>\s*/;
/** 工作区迁移/回退提醒：前置在用户消息之前，渲染成系统事件行而非原始 XML */
const WORKSPACE_MIGRATED_PREFIX = /^<workspace-migrated>\n?([\s\S]*?)\n?<\/workspace-migrated>\s*/;

/** 迁移提醒横幅：图标 + 一句话 + 目标路径，完整原文放 hover title */
function WorkspaceMigratedBanner({ note }: { note: string }) {
  const { t } = useI18n();
  const path = /(?:moved to|main working tree): (.+)$/m.exec(note)?.[1]?.trim();
  const fallback = note.includes('main working tree');
  return (
    <div
      title={note}
      className="flex w-full items-start gap-2 rounded-lg border border-dashed border-border/60 px-3 py-2 text-xs text-muted-foreground"
    >
      <GitBranch className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0">
        {fallback
          ? t('Workspace fell back to the main working tree')
          : t('Workspace moved to an isolated worktree')}
        {path && <span className="ml-1.5 break-all font-mono text-[11px] opacity-80">{path}</span>}
      </span>
    </div>
  );
}
/** Plan 状态提示：worker 前置在用户消息之前，渲染成系统事件行 */
function PlanNoteBanner({ note }: { note: PlanNoteKind }) {
  const { t } = useI18n();
  return (
    <div className="flex w-full items-start gap-2 rounded-lg border border-dashed border-border/60 px-3 py-2 text-xs text-muted-foreground">
      <ClipboardList className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0">
        {note === 'on'
          ? t('Plan mode on: read-only research, then a plan for your approval')
          : note === 'off'
            ? t('Plan mode off')
            : t('Context compacted: the approved plan was attached again')}
      </span>
    </div>
  );
}

/** 主 agent 发给 coworker 的消息包裹 */
const MAIN_AGENT_BLOCK =
  /^<message-from-main-agent>\n?([\s\S]*?)\n?<\/message-from-main-agent>\s*$/;

/** 是否为主 agent 发来的消息(决定气泡靠左与配色;role 前缀在前时也识别) */
function isFromMainAgent(text: string): boolean {
  const role = ROLE_PREFIX.exec(text);
  return MAIN_AGENT_BLOCK.test(role ? text.slice(role[0].length) : text);
}

/** pi 把 /skill:name 展开成整段 XML；气泡里显示高亮 tag，点击看正文 */
const SKILL_BLOCK =
  /^<skill name="([^"]+)" location="([^"]+)">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]+))?$/;

function SkillTag({ name, content }: { name: string; content: string }) {
  const { t } = useI18n();
  return (
    <Dialog>
      <DialogTrigger className={slashChipClass('skill', true)}>
        <Sparkles className="h-3 w-3" />
        {name}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">
            {t('Skill')} · {name}
          </DialogTitle>
        </DialogHeader>
        <DialogPanel className="max-h-[50vh] text-sm">
          <Markdown text={content} />
        </DialogPanel>
      </DialogContent>
    </Dialog>
  );
}

function ChipBubble({ chip, extra }: { chip: ReactNode; extra?: string }) {
  return (
    <div className="max-w-[86%] rounded-[6px] bg-muted px-[16px] py-[10px] text-[14px] leading-[24px]">
      {chip}
      {extra ? <span className="ml-1.5 align-middle whitespace-pre-wrap">{extra}</span> : null}
    </div>
  );
}

function SkillInvocation({ text }: { text: string }) {
  const match = SKILL_BLOCK.exec(text);
  if (!match) return null;
  const [, name, , content, userMessage] = match;
  return (
    <ChipBubble chip={<SkillTag name={name} content={content} />} extra={userMessage?.trim()} />
  );
}

function SlashInvocation({ text }: { text: string }) {
  const parsed = splitSlashCommand(text);
  if (!parsed.slash) return null;
  return <ChipBubble chip={<SlashChip name={parsed.slash} />} extra={parsed.rest.trim()} />;
}

/** 侧边栏触发的预设工作流：卡片展示名称与参数，块后给模型的说明不显示 */
function WorkflowPresetInvocation({
  preset,
}: {
  preset: NonNullable<ReturnType<typeof parseWorkflowPresetMessage>>;
}) {
  const { t } = useI18n();
  return (
    <div className="min-w-64 max-w-[80%] overflow-hidden rounded-lg bg-accent/70 text-sm">
      <div className="flex items-center gap-2.5 px-3.5 py-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-info/15 text-info">
          <Workflow className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] text-muted-foreground">{t('Workflow preset')}</p>
          <p className="truncate font-medium" title={preset.id}>
            {preset.name || preset.id}
          </p>
        </div>
      </div>
      {preset.args.length > 0 && (
        <dl className="space-y-1 border-t border-border/60 px-3.5 py-2 text-xs">
          {preset.args.map(([key, value]) => (
            <div key={key} className="flex gap-2">
              <dt className="shrink-0 font-mono text-muted-foreground">{key}</dt>
              <dd className="min-w-0 whitespace-pre-wrap break-words">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/** 内联提及卡片：与输入框编辑器的卡片完全同款（图标 + 文件名/标题），
 * 保持在句子里的原位与顺序 */
function InlineMentionCard({
  kind,
  label,
  title,
}: {
  kind: 'file' | 'chat' | 'ui-element';
  label: string;
  title: string;
}) {
  const Icon = kind === 'file' ? FileText : kind === 'chat' ? History : BoxSelect;
  return (
    <span
      className={cn(
        mentionChipClass(kind),
        // align-middle + leading-4：与 CJK 正文光学居中（baseline+translate 会偏高）
        'mx-0.5 max-w-52 rounded-md px-1.5 align-middle leading-4'
      )}
      title={title}
    >
      <Icon className="h-3 w-3 shrink-0" />
      <span className="truncate">{label}</span>
    </span>
  );
}

/** 正文里的 @path / chat 引用块原位渲染成卡片，其余文本原样 */
function InlineMentionText({
  text,
  searchQuery = '',
  activeNth = -1,
}: {
  text: string;
  searchQuery?: string;
  activeNth?: number;
}) {
  const segments = splitInlineMentions(text);
  const counter = { n: 0 };
  return (
    <span className="whitespace-pre-wrap">
      {segments.map((segment, index) =>
        segment.type === 'file' ? (
          <InlineMentionCard
            // biome-ignore lint/suspicious/noArrayIndexKey: 同一文件可重复提及，分段随文本快照整体替换
            key={index}
            kind="file"
            label={segment.path.split(/[\\/]/).at(-1) || segment.path}
            title={segment.path}
          />
        ) : segment.type === 'chat' ? (
          <InlineMentionCard
            // biome-ignore lint/suspicious/noArrayIndexKey: 分段随文本快照整体替换
            key={index}
            kind="chat"
            label={segment.label}
            title={segment.sessionFile}
          />
        ) : segment.type === 'ui-element' ? (
          <InlineMentionCard
            // biome-ignore lint/suspicious/noArrayIndexKey: 分段随文本快照整体替换
            key={index}
            kind="ui-element"
            label={segment.label}
            title={`${segment.path}${segment.text ? ` · ${segment.text}` : ''}`}
          />
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: 分段随文本快照整体替换
          <span key={index}>
            {searchQuery.trim()
              ? renderHighlighted(segment.text, searchQuery, activeNth, counter)
              : segment.text}
          </span>
        )
      )}
    </span>
  );
}

/** 旧格式历史消息：尾部追加的引用块渲染成同款卡片行 */
function MentionRefChips({
  files,
  chats,
}: {
  files: string[];
  chats: { label: string; sessionFile: string }[];
}) {
  return (
    <span className="mt-1.5 flex flex-wrap gap-1.5">
      {files.map((path) => (
        <InlineMentionCard
          key={`f:${path}`}
          kind="file"
          label={path.split('/').at(-1) || path}
          title={path}
        />
      ))}
      {chats.map((chat) => (
        <InlineMentionCard
          key={`c:${chat.sessionFile}`}
          kind="chat"
          label={chat.label}
          title={chat.sessionFile}
        />
      ))}
    </span>
  );
}

export const USER_BUBBLE =
  'max-w-[86%] rounded-[6px] bg-muted px-[16px] py-[10px] text-[14px] leading-[24px]';

/**
 * 用户消息长文折叠（对齐 ZCode）：超过 120px 时裁切并用遮罩渐隐，气泡底部居中一个圆形展开按钮。
 * scrollHeight 不受 max-height 影响，量到的就是完整正文高度；正文变化时回到收起态。
 */
function CollapsibleUserText({ text, children }: { text: string; children: ReactNode }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const [fullHeight, setFullHeight] = useState(0);
  const [expanded, setExpanded] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 正文变化要重置折叠态并重新测量
  useLayoutEffect(() => {
    setExpanded(false);
    const el = ref.current;
    if (!el) return;
    setFullHeight(el.scrollHeight);
    if (typeof ResizeObserver === 'undefined') return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setFullHeight(el.scrollHeight));
    });
    observer.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [text]);
  const collapsible = shouldCollapseUserQuery(fullHeight);
  const clamped = collapsible && !expanded;
  const label = expanded ? t('Collapse') : t('Expand');
  return (
    <div className="relative min-w-0" data-user-query="">
      <div
        ref={ref}
        data-user-query-clamped={clamped ? '' : undefined}
        style={{
          maxHeight: collapsible
            ? Math.max(USER_QUERY_MAX_HEIGHT, expanded ? fullHeight : 0)
            : undefined,
        }}
        className={cn(
          'overflow-hidden whitespace-pre-wrap [overflow-wrap:anywhere] transition-[max-height] duration-300 ease-out motion-reduce:transition-none',
          clamped &&
            '[mask-image:linear-gradient(to_bottom,black_0%,black_70%,transparent_100%)] [-webkit-mask-image:linear-gradient(to_bottom,black_0%,black_70%,transparent_100%)]'
        )}
      >
        {children}
      </div>
      {collapsible && (
        <div
          className={cn('flex justify-center', expanded ? 'pt-2' : 'absolute inset-x-0 bottom-0')}
        >
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            aria-label={label}
            title={label}
            className="flex size-7 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronDown className={cn('size-4 transition-transform', expanded && 'rotate-180')} />
          </button>
        </div>
      )}
    </div>
  );
}

/** 用户气泡：识别合成标记,渲染成系统事件行 / 角色块 / 来源徽章而非原始 XML */
function UserText({
  text,
  searchQuery = '',
  activeNth = -1,
}: {
  text: string;
  searchQuery?: string;
  activeNth?: number;
}) {
  const { t } = useI18n();
  const host = useChatHost();
  const botHost = Boolean(host?.speaker || host?.botSession);
  const injected = botHost ? parseBotInjectedMessage(text) : null;
  if (injected) return <InjectedMessageCard message={injected} />;
  // Main 投递前追加的笔记更新块不展示
  const withoutNotes = botHost ? stripBotNotesUpdate(text) : text;
  if (withoutNotes !== text)
    return <UserText text={withoutNotes} searchQuery={searchQuery} activeNth={activeNth} />;
  // Bot 输入框 @聊天：Main 追加的摘录块折叠成 chip
  const chatRefs = botHost ? splitChatReferences(text) : null;
  if (chatRefs?.refs.length) {
    return (
      <div className="flex w-full flex-col items-end gap-1.5">
        {chatRefs.body && (
          <UserText text={chatRefs.body} searchQuery={searchQuery} activeNth={activeNth} />
        )}
        <div className="flex flex-wrap justify-end gap-1.5">
          {chatRefs.refs.map((ref) => (
            <span
              key={ref.id}
              title={t('Referenced chat')}
              className="inline-flex h-6 max-w-56 items-center gap-1 rounded-md bg-muted px-1.5 text-xs"
            >
              <MessagesSquare className="h-3 w-3 shrink-0" />
              <span className="min-w-0 truncate">{ref.title}</span>
            </span>
          ))}
        </div>
      </div>
    );
  }
  const planPrefix = splitPlanPrefix(text);
  if (planPrefix.note) {
    const remainder = planPrefix.rest.trim();
    return (
      <div className="flex w-full flex-col items-end gap-1.5">
        <PlanNoteBanner note={planPrefix.note} />
        {remainder && <UserText text={remainder} searchQuery={searchQuery} activeNth={activeNth} />}
      </div>
    );
  }
  const planMessage = parsePlanMessage(text);
  if (planMessage?.kind === 'approved') {
    return (
      <div className="flex w-full items-start gap-2 rounded-lg border border-dashed border-border/60 px-3 py-2 text-xs text-muted-foreground">
        <ClipboardCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0">
          {t('Plan approved, executing')}
          <span className="ml-1.5 text-foreground">{planMessage.title}</span>
        </span>
      </div>
    );
  }
  if (planMessage?.kind === 'feedback') {
    return (
      <div className={cn(USER_BUBBLE, 'whitespace-pre-wrap')}>
        <p className="mb-1 flex items-center gap-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
          <ClipboardList className="h-3 w-3" />
          {t('Plan feedback')}
        </p>
        <InlineMentionText
          text={planMessage.feedback}
          searchQuery={searchQuery}
          activeNth={activeNth}
        />
      </div>
    );
  }
  const workflowPreset = parseWorkflowPresetMessage(text);
  if (workflowPreset) return <WorkflowPresetInvocation preset={workflowPreset} />;
  const refs = splitMentionRefs(text);
  const hasRefs = refs.files.length > 0 || refs.chats.length > 0;
  if (hasRefs) {
    const parsed = splitSlashCommand(refs.body);
    return (
      <div className={USER_BUBBLE}>
        {parsed.slash ? (
          <>
            <SlashChip name={parsed.slash} />
            {parsed.rest.trim() ? (
              <span className="ml-1.5 align-middle">
                <InlineMentionText
                  text={parsed.rest.trim()}
                  searchQuery={searchQuery}
                  activeNth={activeNth}
                />
              </span>
            ) : null}
          </>
        ) : (
          <InlineMentionText text={refs.body} searchQuery={searchQuery} activeNth={activeNth} />
        )}
        <MentionRefChips files={refs.files} chats={refs.chats} />
      </div>
    );
  }
  if (SKILL_BLOCK.test(text)) return <SkillInvocation text={text} />;
  if (splitSlashCommand(text).slash) return <SlashInvocation text={text} />;
  const migrated = WORKSPACE_MIGRATED_PREFIX.exec(text);
  if (migrated) {
    const remainder = text.slice(migrated[0].length).trim();
    return (
      <div className="flex w-full flex-col items-end gap-1.5">
        <WorkspaceMigratedBanner note={migrated[1]} />
        {remainder && (
          <div className={cn(USER_BUBBLE, 'whitespace-pre-wrap')}>
            <InlineMentionText text={remainder} searchQuery={searchQuery} activeNth={activeNth} />
          </div>
        )}
      </div>
    );
  }
  const block = SYNTHETIC_BLOCK.exec(text);
  if (block) {
    return (
      <div className="flex w-full items-start gap-2 rounded-lg border border-dashed border-border/60 px-3 py-2 text-xs text-muted-foreground">
        {block[1].startsWith('coworker-') || block[1] === 'agent-notification' ? (
          <Bot className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        ) : (
          <TerminalSquare className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        )}
        <span className="whitespace-pre-wrap">{block[2]}</span>
      </div>
    );
  }
  const role = ROLE_PREFIX.exec(text);
  const rest = role ? text.slice(role[0].length) : text;
  const fromMain = MAIN_AGENT_BLOCK.exec(rest);
  const body = fromMain ? fromMain[1] : rest;
  return (
    <div
      className={cn(
        fromMain
          ? 'max-w-[86%] rounded-[6px] border border-primary/20 bg-primary/8 px-[16px] py-[10px] text-[14px] leading-[24px]'
          : USER_BUBBLE
      )}
    >
      {fromMain && (
        <p className="mb-1 flex items-center gap-1 text-[11px] font-medium text-primary">
          <Bot className="h-3 w-3" />
          {t('From main agent')}
        </p>
      )}
      {role?.[1] && !isBtwIsolationPrompt(role[1]) && (
        <div className="mb-2 rounded-md bg-background/60 px-2.5 py-1.5 text-xs text-muted-foreground">
          <span className="font-semibold">{t('Role')}</span> · {role[1]}
        </div>
      )}
      {fromMain ? (
        <Markdown text={body} searchQuery={searchQuery} activeNth={activeNth} />
      ) : (
        <CollapsibleUserText text={body}>
          <InlineMentionText text={body} searchQuery={searchQuery} activeNth={activeNth} />
        </CollapsibleUserText>
      )}
    </div>
  );
}

/** 展开的分组平铺出来的子项：左侧细竖线串起，不带图标 */
export function isNestedRow(item: TimelineItem): boolean {
  return (item.kind === 'tool' || item.kind === 'thinking') && item.nested === true;
}

/** 每轮回复的身份头：标识 + 模型 + 时间，挂在本轮首个 assistant 行之上 */
export function ReplyHeader({ model, at }: { model?: string; at?: number }) {
  const speaker = useChatHost()?.speaker;
  return (
    <div className="mb-[8px] flex min-h-[20px] min-w-0 items-center gap-[8px] text-[12px] select-none">
      {speaker ? (
        speaker.image ? (
          <img
            src={speaker.image}
            alt=""
            draggable={false}
            className="size-[22px] shrink-0 rounded-full object-cover"
            style={{ backgroundColor: speaker.color }}
          />
        ) : (
          <span
            className="flex size-[22px] shrink-0 items-center justify-center rounded-full font-semibold text-[11px] text-white"
            style={{ backgroundColor: speaker.color }}
          >
            {[...speaker.name.trim()][0]?.toUpperCase() ?? '?'}
          </span>
        )
      ) : (
        <span className="flex size-[17px] shrink-0 items-center justify-center text-foreground">
          <EnsoMark className="size-[17px]" />
        </span>
      )}
      <span className="shrink-0 truncate font-medium text-foreground">
        {speaker?.name ?? 'Enso'}
      </span>
      {model && <span className="min-w-0 truncate text-[11px] text-muted-foreground">{model}</span>}
      {typeof at === 'number' && (
        <span className="shrink-0 text-[11px] text-muted-foreground">{formatClock(at)}</span>
      )}
    </div>
  );
}

export const TimelineRow = memo(function TimelineRow({
  item,
  onToggleGroup,
  onToggleTurn,
}: TimelineRowProps) {
  const search = useChatSearchHighlight();
  const searchQuery = search.query;
  const activeNth = search.activeKey === item.key ? search.activeNth : -1;
  switch (item.kind) {
    case 'user': {
      const fromMain = item.text ? isFromMainAgent(item.text) : false;
      const isCollapsed = item.collapsed === true;
      return (
        <div
          className={cn('group/user flex flex-col gap-1.5', fromMain ? 'items-start' : 'items-end')}
        >
          {item.images.map((image, index) => (
            <ZoomableImage
              // biome-ignore lint/suspicious/noArrayIndexKey: 图片无稳定 id，消息整体快照替换
              key={index}
              src={`data:${image.mimeType};base64,${image.data}`}
              className="max-h-48 max-w-full rounded-lg border object-contain"
            />
          ))}
          {item.text && (
            <UserText text={item.text} searchQuery={searchQuery} activeNth={activeNth} />
          )}
          {isCollapsed ? (
            <CollapsedTurnBar
              turnKey={item.key}
              timestamp={item.timestamp}
              turnDurationMs={item.turnDurationMs}
              onToggle={onToggleTurn}
            />
          ) : (
            <UserMeta
              turnKey={item.key}
              messageIndex={Number(item.key)}
              text={item.text}
              timestamp={item.timestamp}
              deliveryState={item.deliveryState}
              canCollapse={item.canCollapse}
              onToggleTurn={onToggleTurn}
            />
          )}
        </div>
      );
    }
    case 'text':
      return <TextRow item={item} searchQuery={searchQuery} activeNth={activeNth} />;
    case 'thinking':
      return (
        <ThinkingRow
          itemKey={item.key}
          text={item.text}
          streaming={item.streaming}
          durationMs={item.durationMs}
          nested={item.nested}
        />
      );
    case 'tool':
      return <ToolRow item={item} />;
    case 'tool-group':
      return <ToolGroupRow item={item} onToggle={onToggleGroup} />;
    case 'error':
      return (
        <div className="flex items-start gap-2 text-sm text-destructive">
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p className="min-w-0 flex-1 whitespace-pre-wrap">{item.text}</p>
          <RetryTurnButton />
        </div>
      );
    case 'task-note':
      return <TaskNoteRow item={item} />;
    case 'compaction':
    case 'compaction-notice':
      return <CompactionRow item={item} />;
    case 'compaction-progress':
      return <CompactionProgressRow state={item.state} />;
    case 'session-custom':
      return <SessionCustomRow entry={item.entry} />;
    case 'divider':
      return (
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          {item.text}
          <span className="h-px flex-1 bg-border" />
        </div>
      );
  }
}, itemEqual);

const customValue = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value === undefined) return '—';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

function OauthAccountRow({
  entry,
}: {
  entry: Extract<AgentSessionCustomEntry, { kind: 'oauth-account-selected' }>;
}) {
  const { t } = useI18n();
  const emails = useOauthAccountEmails();
  const current = emails.get(entry.accountKey);
  const previous = entry.previousAccountKey ? emails.get(entry.previousAccountKey) : undefined;
  const text = entry.previousAccountKey
    ? previous && current
      ? t('ChatGPT account switched: {{previous}} → {{current}}', { previous, current })
      : t('ChatGPT account switched')
    : current
      ? t('ChatGPT account selected: {{account}}', { account: current })
      : t('ChatGPT account selected');
  return (
    <div className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/20 px-2.5 py-2 text-xs">
      <RefreshCw className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
      <p className="min-w-0 break-words text-muted-foreground">{text}</p>
    </div>
  );
}

function SessionCustomRow({ entry }: { entry: AgentSessionCustomEntry }) {
  const { t } = useI18n();
  if (entry.kind === 'oauth-account-selected') return <OauthAccountRow entry={entry} />;
  if (entry.kind === 'agent-dispatch') {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-2.5 py-2 text-xs">
        <Bot className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="text-muted-foreground">{t('Dispatched to')}</span>
        <span className="font-medium">{entry.child.instanceName}</span>
      </div>
    );
  }
  if (entry.kind === 'agent-completed') {
    return (
      <div className="flex items-start gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-2 text-xs">
        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
        <div className="min-w-0">
          <p className="font-medium">
            {entry.child.instanceName} · {t('Completed')}
          </p>
          {entry.receiptSummary && (
            <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">
              {entry.receiptSummary}
            </p>
          )}
        </div>
      </div>
    );
  }
  if (entry.kind === 'agent-failed') {
    return (
      <div className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-2.5 py-2 text-xs">
        <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
        <div className="min-w-0">
          <p className="font-medium">
            {entry.child.instanceName} · {t('Failed')}
          </p>
          <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">{entry.message}</p>
        </div>
      </div>
    );
  }

  const receipt = entry.receipt;
  const succeeded = receipt.outcome === 'succeeded';
  return (
    <div
      className={cn(
        'rounded-md border px-2.5 py-2 text-xs',
        succeeded
          ? 'border-emerald-500/20 bg-emerald-500/5'
          : receipt.outcome === 'failed'
            ? 'border-destructive/20 bg-destructive/5'
            : 'border-amber-500/20 bg-amber-500/5'
      )}
    >
      <div className="flex items-start gap-2">
        {succeeded ? (
          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
        ) : (
          <CircleAlert
            className={cn(
              'mt-0.5 h-3.5 w-3.5 shrink-0',
              receipt.outcome === 'failed' ? 'text-destructive' : 'text-amber-500'
            )}
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            {receipt.subject.label} · {t(receipt.outcome)}
          </p>
          <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">{receipt.summary}</p>
          {receipt.changes && receipt.changes.length > 0 && (
            <dl className="mt-2 space-y-1 border-t border-border/50 pt-2">
              {receipt.changes.map((change) => (
                <div key={change.field} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                  <dt className="truncate text-muted-foreground">{change.field}</dt>
                  <dd className="text-right font-mono">
                    {customValue(change.previous)} → {customValue(change.value)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>
    </div>
  );
}

/** 当前展示的会话(主会话或激活的 coworker tab),与 ChatView 的选取逻辑一致 */
function displayedConversation(state: ReturnType<typeof useSessionsStore.getState>) {
  const active = state.activeId ? state.conversations[state.activeId] : null;
  if (!active) return null;
  return active.activeTabId ? (state.conversations[active.activeTabId] ?? active) : active;
}

const noSubscribe = () => () => {};

/** 终态错误后续跑：已 spawn 且非 running 才显示（手机 stub started=false 自动隐藏） */
export function RetryTurnButton() {
  const { t } = useI18n();
  const host = useChatHost();
  const controls = host?.botControls;
  const sessionCanRetry = useSessionsStore((state) => {
    // 远程节点视图：协议无 retry，宿主显式关闭
    if (host && (!host.canRetry || host.botControls)) return false;
    const conversation = displayedConversation(state);
    return Boolean(
      conversation?.started && !conversation.spawning && conversation.status !== 'running'
    );
  });
  // Bot 私聊：投影在 bots store；冷会话由 Main 先恢复再续跑
  const retryable = () => {
    if (!controls || !host?.canRetry) return false;
    const projection = controls.projection();
    return Boolean(projection && projection.status !== 'running');
  };
  const botCanRetry = useSyncExternalStore(
    controls?.subscribe ?? noSubscribe,
    retryable,
    retryable
  );
  const canRetry = controls ? botCanRetry : sessionCanRetry;
  if (!canRetry) return null;
  return (
    <button
      type="button"
      title={t('Retry')}
      onClick={() => {
        if (controls) return controls.retry();
        const conversation = displayedConversation(useSessionsStore.getState());
        if (!conversation) return;
        useSessionsStore.getState().retry(conversation.id);
      }}
      className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
    >
      <RefreshCw className="h-3 w-3" />
      {t('Retry')}
    </button>
  );
}

/** 回退：failed 也可；未 ready 的 spawning / 冷会话走 store 唤醒，不在这里强行显示不安全入口 */
function canRewindDisplayedSession(
  state: ReturnType<typeof useSessionsStore.getState>,
  host: ReturnType<typeof useChatHost>
) {
  return canShowConversationRewind(displayedConversation(state), host);
}

const userActionClass =
  'flex items-center gap-1 text-[11px] text-muted-foreground transition-opacity hover:text-foreground';

/** 分叉入口：与回退并列；idle 的 root 显示，冷会话点击时由 store 先唤醒 */
function ForkButton({ messageIndex }: { messageIndex: number }) {
  const { t } = useI18n();
  const host = useChatHost();
  const canFork = useSessionsStore((state) =>
    canShowConversationFork(displayedConversation(state), host)
  );
  if (!canFork) return null;
  return (
    <button
      type="button"
      className={userActionClass}
      title={t('Keep this session and start a parallel one from here')}
      onClick={() => {
        const state = useSessionsStore.getState();
        const conversation = displayedConversation(state);
        if (!conversation) return;
        const userIndexFromEnd = userIndexFromEndForTurnKey(conversation, messageIndex);
        if (userIndexFromEnd === null) return;
        void state.forkFromMessage(conversation.id, userIndexFromEnd);
      }}
    >
      <GitBranch className="h-3 w-3" />
      {t('Conversation branch')}
    </button>
  );
}

function WithdrawButton({ messageIndex }: { messageIndex: number }) {
  const { t } = useI18n();
  const host = useChatHost();
  const conversationId = useSessionsStore((state) => displayedConversation(state)?.id);
  const deliveryId = useSessionsStore((state) => {
    const conversation = conversationId ? state.conversations[conversationId] : undefined;
    if (
      host ||
      !conversation ||
      conversation.historyOnly ||
      conversation.rewinding ||
      conversation.restoringFiles ||
      conversation.workspaceMigrating
    )
      return undefined;
    const message = conversation.messages[messageIndex - (conversation.historyBaseIndex ?? 0)];
    return canWithdrawMessage(message) ? message.deliveryId : undefined;
  });
  if (!conversationId || !deliveryId) return null;
  return (
    <button
      type="button"
      title={t('Withdraw message')}
      onClick={() =>
        useSessionsStore
          .getState()
          .withdrawMessage(conversationId, { kind: 'delivery', id: deliveryId })
      }
      className="inline-flex items-center gap-1 hover:text-foreground"
    >
      <Undo2 className="h-3 w-3" />
      {t('Withdraw message')}
    </button>
  );
}

/** 回退入口：已 spawn 非 spawning，或可 resume 的历史主会话。未恢复 coworker / remote / historyOnly 不显示；活 child 保持。 */
function RewindButton({ messageIndex }: { messageIndex: number }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  /** 确认框绑定打开时的会话与持久化消息，不能随时间线位置漂移。 */
  const [pending, setPending] = useState<{
    restoreFiles: boolean;
    conversationId: string;
    entryId: string;
  } | null>(null);
  const host = useChatHost();
  const controls = host?.botControls;
  const sessionCanRewind = useSessionsStore((state) => {
    if (host?.botControls) return false;
    const conversation = displayedConversation(state);
    return (
      canRewindDisplayedSession(state, host) &&
      Boolean(
        conversation &&
          resolveRewindConfirm(conversation.id, conversation.id, conversation, messageIndex)
      )
    );
  });
  /** Bot 私聊：该行可回退时返回目标 user entryId（原始值选择，避免流式更新重渲染每行） */
  const rewindTarget = () => {
    if (!controls || !host?.canRewind || !host.sessionId) return null;
    const projection = controls.projection();
    if (!projection || projection.status === 'running') return null;
    return (
      resolveRewindConfirm(host.sessionId, host.sessionId, projection, messageIndex)?.entryId ??
      null
    );
  };
  const botEntryId = useSyncExternalStore(
    controls?.subscribe ?? noSubscribe,
    rewindTarget,
    rewindTarget
  );
  const canRewind = controls ? botEntryId !== null : sessionCanRewind;
  if (!canRewind) return null;
  const queueRewind = (restoreFiles: boolean) => {
    if (controls && host?.sessionId && botEntryId) {
      setPending({ restoreFiles, conversationId: host.sessionId, entryId: botEntryId });
      return;
    }
    const conversation = displayedConversation(useSessionsStore.getState());
    if (!conversation) return;
    const target = resolveRewindConfirm(
      conversation.id,
      conversation.id,
      conversation,
      messageIndex
    );
    if (target)
      setPending({ restoreFiles, conversationId: conversation.id, entryId: target.entryId });
  };
  const rewind = (restoreFiles: boolean, originId: string, entryId: string) => {
    if (controls) return controls.rewind(entryId, restoreFiles);
    const state = useSessionsStore.getState();
    const displayed = displayedConversation(state);
    const target = resolveRewindConfirm(
      originId,
      displayed?.id,
      state.conversations[originId],
      messageIndex,
      entryId
    );
    if (!target) return;
    state.rewind(target.conversationId, target.entryId, restoreFiles);
  };
  const options = [
    {
      icon: Undo2,
      label: t('Conversation only'),
      desc: t('Rewind to this message'),
      restoreFiles: false,
      action: () => queueRewind(false),
    },
    {
      icon: History,
      label: t('Conversation + files'),
      desc: t('Rewind and restore files to before this turn'),
      restoreFiles: true,
      action: () => queueRewind(true),
    },
  ];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className={userActionClass} title={t('Rewind to this message')}>
        <Undo2 className="h-3 w-3" />
        {t('Rewind')}
      </PopoverTrigger>
      <PopoverPopup side="bottom" align="end" className="w-72 [&_[data-slot=popover-viewport]]:p-1">
        {options.map((option) => (
          <button
            key={option.label}
            type="button"
            onClick={() => {
              setOpen(false);
              option.action();
            }}
            className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted/60"
          >
            <option.icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block">{option.label}</span>
              <span className="block text-xs text-muted-foreground">{option.desc}</span>
            </span>
          </button>
        ))}
      </PopoverPopup>
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(dialogOpen) => {
          if (!dialogOpen) setPending(null);
        }}
        title={t('Rewind to this message?')}
        description={
          pending?.restoreFiles
            ? t(
                'Later messages leave the current branch and working-tree files are restored to before this turn.'
              )
            : t('Later messages leave the current branch; the text returns to the input box.')
        }
        confirmLabel={t('Rewind')}
        onConfirm={() => {
          if (pending) rewind(pending.restoreFiles, pending.conversationId, pending.entryId);
        }}
      />
    </Popover>
  );
}

function CollapsedTurnBar({
  turnKey,
  timestamp,
  turnDurationMs,
  onToggle,
}: {
  turnKey: string;
  timestamp?: number;
  turnDurationMs?: number;
  onToggle?: (key: string, collapsed: boolean) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/80 select-none">
      <button
        type="button"
        onClick={() => onToggle?.(turnKey, false)}
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground cursor-pointer border border-border/40"
        title={t('Expand')}
      >
        <ChevronRight className="h-3 w-3 shrink-0" />
        <span>{t('Expand')}</span>
      </button>
      {typeof timestamp === 'number' && <span>{formatClock(timestamp)}</span>}
      {turnDurationMs !== undefined && (
        <span>· {t('took {{duration}}', { duration: formatDuration(turnDurationMs) })}</span>
      )}
    </div>
  );
}

function UserMeta({
  turnKey,
  messageIndex,
  text,
  timestamp,
  canCollapse,
  deliveryState,
  onToggleTurn,
}: {
  turnKey: string;
  messageIndex: number;
  text: string;
  timestamp?: number;
  canCollapse?: boolean;
  deliveryState?: 'pending' | 'rejected';
  onToggleTurn?: (key: string, collapsed: boolean) => void;
}) {
  const { t } = useI18n();
  const autoCollapseTurns = useSettingsStore((s) => s.autoCollapseTurns);
  return (
    <div
      className={cn(
        'flex min-h-[24px] items-center gap-2 text-[11px] text-faint transition-opacity select-none',
        !deliveryState && 'opacity-0 group-hover/user:opacity-100 focus-within:opacity-100'
      )}
    >
      <RewindButton messageIndex={messageIndex} />
      <WithdrawButton messageIndex={messageIndex} />
      {deliveryState && (
        <span>{t(deliveryState === 'rejected' ? 'Not sent' : 'Delivery unconfirmed')}</span>
      )}
      {autoCollapseTurns && canCollapse && onToggleTurn && (
        <button
          type="button"
          onClick={() => onToggleTurn(turnKey, true)}
          className={cn(userActionClass, 'cursor-pointer opacity-0 group-hover/user:opacity-100')}
          title={t('Collapse')}
        >
          <ChevronDown className="h-3 w-3 shrink-0" />
          <span>{t('Collapse')}</span>
        </button>
      )}
      {text && (
        <span className="flex opacity-0 transition-opacity group-hover/user:opacity-100 focus-within:opacity-100">
          <CopyButton text={text} />
        </span>
      )}
      {typeof timestamp === 'number' && <span>{formatClock(timestamp)}</span>}
    </div>
  );
}

/** assistant 正文：markdown + hover 操作条（复制 / 时间 / 该轮耗时·TTFT·tok/s） */
function TextRow({
  item,
  searchQuery = '',
  activeNth = -1,
}: {
  item: Extract<TimelineItem, { kind: 'text' }>;
  searchQuery?: string;
  activeNth?: number;
}) {
  const { t } = useI18n();
  const host = useChatHost();
  const perfStr = item.perf ? formatPerf(item.perf, t, item.turnDurationMs !== undefined) : '';
  return (
    <div className="group text-[15px] leading-[27px] [&_h1]:text-[18px] [&_h2]:text-[18px] [&_h3]:text-[16px]">
      <Markdown
        text={item.text}
        streaming={item.streaming}
        searchQuery={searchQuery}
        activeNth={activeNth}
      />
      {item.turnEnd &&
        !item.streaming &&
        (host?.turnFooter ? (
          host.turnFooter(Number(item.key.split('-')[0]))
        ) : (
          <TurnFilesFooter messageIndex={Number(item.key.split('-')[0])} />
        ))}
      {!item.streaming && (
        <div className="mt-[12px] flex min-h-[24px] items-center gap-2 text-[11px] text-faint opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <CopyButton text={item.text} />
          {item.turnEnd && <ForkButton messageIndex={Number(item.key.split('-')[0])} />}
          {item.timestamp && <span>{formatClock(item.timestamp)}</span>}
          {item.turnDurationMs !== undefined && (
            <span>
              · {t('took {{duration}}', { duration: formatDuration(item.turnDurationMs) })}
            </span>
          )}
          {perfStr && <span>· {perfStr}</span>}
        </div>
      )}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1000);
        });
      }}
      className="flex items-center gap-1 transition-colors hover:text-foreground"
      title={t('Copy')}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

const pad2 = (n: number): string => String(n).padStart(2, '0');
const formatClock = (ms: number): string => {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};
/** 秒：<10s 一位小数，否则整数 */
const secs = (ms: number): string => {
  const s = ms / 1000;
  return s < 10 ? String(Math.round(s * 10) / 10) : String(Math.round(s));
};
/** 末 step 读数：本 step 耗时 · TTFT · tok/s；多 step 轮次再附「总计 Xs」= 整轮活跃用时 */
function formatPerf(perf: TurnPerf, t: TFunction, hasTurnDuration = false): string {
  const parts: string[] = [];
  // 单 step 的用时已由「took」展示；多 step 仍保留末 step 墙钟（turnMs 有值）
  if (!hasTurnDuration || perf.turnMs !== undefined) {
    parts.push(`${secs(perf.runMs)}s`);
  }
  if (perf.ttftMs !== undefined) parts.push(`TTFT ${secs(perf.ttftMs)}s`);
  if (perf.tps !== undefined) parts.push(`${Math.round(perf.tps)} tok/s`);
  if (!hasTurnDuration && perf.turnMs !== undefined) {
    parts.push(t('total {{duration}}', { duration: formatDuration(perf.turnMs) }));
  }
  return parts.join(' · ');
}

/** 流式思考摘要：最后一行非空正文；行号作为滚动 key，同一行续写只原位刷新 */
function lastNonEmptyLine(text: string): { index: number; text: string } | null {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim() ?? '';
    if (line) return { index, text: line };
  }
  return null;
}

/** Think 行：仅在 expandLiveReasoning 时流式展开、结束收起；手动点击覆盖默认 */
function ThinkingRow({
  itemKey,
  text,
  streaming,
  durationMs,
  nested,
}: {
  itemKey: string;
  text: string;
  streaming: boolean;
  durationMs: number | null;
  /** 展开的工具组内：不带图标，与组内工具行对齐 */
  nested?: boolean;
}) {
  const { t } = useI18n();
  const expandLiveReasoning = useSettingsStore((s) => s.expandLiveReasoning);
  const [userToggled, setUserToggled] = useState<boolean | null>(null);
  const expanded = thinkingRowExpanded(userToggled, streaming, expandLiveReasoning);
  const lastLine = streaming && !expanded ? lastNonEmptyLine(text) : null;
  return (
    <div>
      <ToolSummaryRow
        icon={nested ? undefined : Brain}
        kind={streaming ? t('Thinking') : t('Thought')}
        running={streaming}
        separator={!streaming || lastLine !== null}
        summary={
          streaming ? (
            lastLine ? (
              <span className="min-w-0 truncate">{lastLine.text}</span>
            ) : undefined
          ) : (
            <span className="whitespace-nowrap">
              {durationMs !== null ? formatDuration(durationMs) : t('a few seconds')}
            </span>
          )
        }
        animate={streaming}
        contentKey={lastLine ? `reasoning-line:${lastLine.index}` : `${itemKey}:done`}
        refreshVersion={lastLine?.text}
        expanded={expanded}
        onToggle={() => setUserToggled(!expanded)}
      />
      {expanded && <ReasoningBody text={text} streaming={streaming} />}
    </div>
  );
}

/**
 * 展开的推理正文：高度封顶并独立滚动。
 * 长思考不封顶会把答复和输入框整体推出视口，所以只在框内滚动；
 * 流式期间若用户没往回滚，就跟着最新 token 走。
 */
function ReasoningBody({ text, streaming }: { text: string; streaming: boolean }) {
  const bodyRef = useRef<HTMLParagraphElement>(null);
  /** 默认贴底；用户向上翻看历史推理时暂停自动跟随 */
  const stickToBottom = useRef(true);
  // useLayoutEffect：推理块本身是个小滚动区，等 paint 之后再贴底会先画一帧旧位置，
  // 流式高频增量下这一帧滞后就是「思考小滚条在抖」的来源。
  // biome-ignore lint/correctness/useExhaustiveDependencies: text/streaming 只作为跟随触发信号，不参与计算
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body || !stickToBottom.current) return;
    body.scrollTop = body.scrollHeight;
  }, [text, streaming]);
  return (
    <p
      ref={bodyRef}
      onScroll={() => {
        const body = bodyRef.current;
        if (!body) return;
        stickToBottom.current = body.scrollHeight - body.scrollTop - body.clientHeight < 32;
      }}
      className={cn(
        // 流式时只开一个小窗口（约 4 行），像活动指示而不是正文；
        // 思考结束后用户主动展开才给完整高度。
        't-acc-reveal scroll-stable scroll-pill mt-2 ml-2 overflow-y-auto border-l border-border py-0.5 pl-3.5 text-[13px] leading-relaxed text-muted-foreground/70 whitespace-pre-wrap',
        streaming ? 'max-h-28' : 'max-h-[min(16rem,38vh)]'
      )}
    >
      {text}
    </p>
  );
}

/** 后台任务完成事件：分隔线嵌字；点击展开详情与完整日志 */
function TaskNoteRow({ item }: { item: Extract<TimelineItem, { kind: 'task-note' }> }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  /** undefined=未读, null=文件不存在, string=内容。占位文案在渲染时 t()，切语言才会更新 */
  const [log, setLog] = useState<string | null | undefined>(undefined);
  const match = /^Background task (\S+) finished \((.+?), ran (.+?)\)/.exec(item.summary);
  const text = match ? `${match[1]} · ${match[2]} · ${match[3]}` : item.summary;
  const logPath = /read (\/.+?\.log) for the complete log/.exec(item.detail)?.[1] ?? null;

  useEffect(() => {
    if (!expanded || !logPath || log !== undefined) return;
    void window.electronAPI.files
      .read(logPath)
      .then((content) => {
        setLog(typeof content === 'string' ? content : null);
      })
      // 同 EditDiff：读失败也要落地成明确状态，否则一直是「加载中」
      .catch(() => setLog(null));
  }, [expanded, logPath, log]);

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3"
        title={item.detail}
      >
        <span className="h-px flex-1 bg-border" />
        <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground">
          <Check className="h-3 w-3 text-green-600 dark:text-green-500" />
          {text}
          <ChevronRight className={cn('h-3 w-3 transition-transform', expanded && 'rotate-90')} />
        </span>
        <span className="h-px flex-1 bg-border" />
      </button>
      {expanded && (
        <div className="mt-1.5 rounded-lg border border-border/60 bg-muted/20">
          <pre className="border-b border-border/60 px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
            {item.detail}
          </pre>
          <pre className="scroll-stable scroll-pill max-h-64 overflow-auto px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
            {logPath
              ? log === undefined
                ? t('Loading…')
                : stripAnsi(log ?? t('(log unavailable)'))
              : t('(no log available)')}
          </pre>
        </div>
      )}
    </div>
  );
}

function CompactionProgressRow({
  state,
}: {
  state: Extract<TimelineItem, { kind: 'compaction-progress' }>['state'];
}) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
      <LoaderCircle className="h-3 w-3 animate-spin" />
      <span>{state === 'queued' ? t('Compacts after this turn') : t('Compacting…')}</span>
    </div>
  );
}

/**
 * compaction 分隔：之上的历史已被压缩出模型上下文；点击展开看模型拿到的摘要。
 * compaction-notice（锚在压缩时刻的提示）**不画分隔线**：它上方还包含仍在
 * 上下文里的保留段，画成线会被误读成「此线之上都已压出上下文」。
 */
function CompactionRow({
  item,
}: {
  item: Extract<TimelineItem, { kind: 'compaction' | 'compaction-notice' }>;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const divider = item.kind === 'compaction';
  const tokens = item.tokensBefore === null ? null : formatTokens(item.tokensBefore);
  const label = item.memory
    ? tokens === null
      ? t('Memory context compacted')
      : t('Memory context compacted ({{tokens}} tokens before)', { tokens })
    : item.verified
      ? tokens === null
        ? t('Verified context compacted')
        : t('Verified context compacted ({{tokens}} tokens before)', { tokens })
      : tokens === null
        ? t('Context compacted')
        : t('Context compacted ({{tokens}} tokens before)', { tokens });
  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className={cn('flex items-center gap-3', divider && 'w-full')}
        title={
          item.memory
            ? t(
                'Summary rendered from continuous memory. Messages above are no longer in the model context; use recall for sources.'
              )
            : item.verified
              ? t(
                  'Verified summary from smart compaction. Messages above are no longer in the model context.'
                )
              : divider
                ? t('Messages above are no longer in the model context; only this summary is.')
                : t('Latest compaction summary — expand to read what the model kept.')
        }
      >
        {divider && <span className="h-px flex-1 bg-border" />}
        <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground">
          <PackageMinus className="h-3 w-3" />
          {label}
          <ChevronRight className={cn('h-3 w-3 transition-transform', expanded && 'rotate-90')} />
        </span>
        {divider && <span className="h-px flex-1 bg-border" />}
      </button>
      {expanded && (
        <pre className="scroll-stable scroll-pill mt-1.5 max-h-80 overflow-auto rounded-lg border border-border/60 bg-muted/20 px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
          {item.summary || t('(summary unavailable)')}
        </pre>
      )}
    </div>
  );
}

/** 回合工作日志头文案：时长未知时不编造 0 秒 */
function worklogLabel(
  worklog: NonNullable<Extract<TimelineItem, { kind: 'tool-group' }>['worklog']>,
  t: TFunction
): string {
  const duration =
    worklog.durationMs !== undefined ? formatDuration(worklog.durationMs) : undefined;
  if (worklog.status === 'aborted')
    return duration ? t('Stopped after {{duration}}', { duration }) : t('Stopped');
  if (worklog.status === 'failed')
    return duration ? t('Failed after {{duration}}', { duration }) : t('Failed run');
  return duration ? t('Worked for {{duration}}', { duration }) : t('Worked');
}

/** 运行中的工作日志头：每秒刷新「工作中 N 秒」，只重渲染自身，不惊动整行 memo */
const LiveWorklogLabel = memo(function LiveWorklogLabel({ since }: { since?: number }) {
  const { t } = useI18n();
  const [, tick] = useState(0);
  useEffect(() => {
    if (since === undefined) return;
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [since]);
  const label =
    since === undefined
      ? t('Working')
      : t('Working for {{duration}}', {
          duration: formatDuration(Math.max(0, Date.now() - since)),
        });
  return (
    <span className="t-shimmer truncate" data-text={label}>
      {label}
    </span>
  );
});

/**
 * 回合工作日志头（对齐 ZCode「已工作 N 秒 ›」）：一行弱化文字 + 底部细线，不占时间线节点列。
 * 强制展开（运行中 / 中断 / 失败 / 无最终答案）时不可收起，也不显示 chevron。
 */
function WorklogHead({
  item,
  worklog,
  onToggle,
}: {
  item: Extract<TimelineItem, { kind: 'tool-group' }>;
  worklog: NonNullable<Extract<TimelineItem, { kind: 'tool-group' }>['worklog']>;
  onToggle?: (key: string) => void;
}) {
  const { t } = useI18n();
  const detail: string[] = [];
  if (worklog.thinking > 0) detail.push(t('{{count}} thinking steps', { count: worklog.thinking }));
  if (item.count > 0) detail.push(t('{{count}} tool calls', { count: item.count }));
  const label = (
    <>
      {worklog.status === 'running' ? (
        <LiveWorklogLabel since={worklog.startedAt} />
      ) : (
        <span className={cn('truncate', worklog.status === 'failed' && 'text-destructive')}>
          {worklogLabel(worklog, t)}
        </span>
      )}
      {!worklog.forced && (
        <ChevronRight
          aria-hidden
          className={cn(
            'size-3.5 shrink-0 opacity-70 transition-transform',
            item.expanded && 'rotate-90'
          )}
        />
      )}
    </>
  );
  return (
    <div
      data-worklog-head=""
      data-worklog-status={worklog.status}
      className="flex w-full items-center gap-[8px] text-[12px] text-muted-foreground"
    >
      {worklog.status === 'running' ? (
        <LoaderCircle className="size-[14px] shrink-0 animate-spin text-primary" aria-hidden />
      ) : (
        <CircleCheck
          className={cn(
            'size-[14px] shrink-0',
            worklog.status === 'failed' ? 'text-destructive' : 'text-success'
          )}
          aria-hidden
        />
      )}
      {worklog.forced ? (
        <div className="inline-flex min-w-0 items-center gap-1.5">{label}</div>
      ) : (
        <button
          type="button"
          onClick={() => onToggle?.(item.key)}
          aria-expanded={item.expanded}
          className="inline-flex min-w-0 items-center gap-1.5 rounded text-left transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {label}
        </button>
      )}
      {!item.expanded && detail.length > 0 && (
        <span className="min-w-0 truncate text-muted-foreground/70">{detail.join(' · ')}</span>
      )}
      {worklog.failed > 0 && (
        <span className="ml-auto shrink-0 rounded bg-destructive/12 px-1.5 py-px text-[10px] text-destructive">
          {t('{{count}} calls failed', { count: worklog.failed })}
        </span>
      )}
    </div>
  );
}

/** 收拢的工具组头：摘要统计 + chevron；点击展开为组内原始行。compact 下对齐 Cursor：Explored / Exploring */
function ToolGroupRow({
  item,
  onToggle,
}: {
  item: Extract<TimelineItem, { kind: 'tool-group' }>;
  onToggle?: (key: string) => void;
}) {
  const { t } = useI18n();
  const compact = useSettingsStore((s) => s.compactReadOnlyTools);
  if (item.worklog) return <WorklogHead item={item} worklog={item.worklog} onToggle={onToggle} />;
  const parts: string[] = [];
  if (item.stats.commands > 0)
    parts.push(t('ran {{count}} commands', { count: item.stats.commands }));
  if (item.stats.reads > 0) parts.push(t('read {{count}} files', { count: item.stats.reads }));
  if (item.stats.searches > 0)
    parts.push(t('searched {{count}} times', { count: item.stats.searches }));
  if (item.stats.others > 0) parts.push(t('{{count}} other calls', { count: item.stats.others }));
  const explored: string[] = [];
  if (compact) {
    if (item.stats.reads > 0) explored.push(t('{{count}} files', { count: item.stats.reads }));
    if (item.stats.searches > 0)
      explored.push(t('{{count}} searches', { count: item.stats.searches }));
  }
  // 组内失败数：折叠时也要能看见，否则失败被埋在展开体里
  const failedCount = item.children.filter(
    (child) => child.kind === 'tool' && child.state === 'error'
  ).length;
  const explore = item.explore;
  const running = item.exploring;
  const kind = explore
    ? toolLabel('explore_fold', t)
    : item.terminal
      ? t(running ? 'Executing' : 'Terminal')
      : compact
        ? t(running ? 'Looking up' : 'Looked up')
        : t('{{count}} tool calls', { count: item.count });
  const detail = explore
    ? [explore.goal, t('{{count}} tool calls', { count: item.count })].filter(Boolean)
    : item.terminal
      ? [t('{{count}} command(s)', { count: item.count })]
      : compact
        ? explored
        : parts;
  // 运行中摘要滚动显示最新一条子工具（对齐 ZCode「正在执行 · <命令>」）
  const latest = running ? item.children.findLast((child) => child.kind === 'tool') : undefined;
  const latestTool = latest?.kind === 'tool' ? latest : undefined;
  const summaryText = latestTool ? latestTool.summary : detail.join(' · ');
  const head = (
    <div data-explore-head={explore ? '' : undefined}>
      <ToolSummaryRow
        icon={explore ? FoldVertical : item.terminal ? TerminalSquare : Search}
        kind={kind}
        separator
        summary={summaryText ? <span className="min-w-0 truncate">{summaryText}</span> : undefined}
        animate={running}
        contentKey={latestTool ? `child:${latestTool.key}` : `${item.key}:done:${summaryText}`}
        status={
          failedCount > 0 ? (
            <span className="shrink-0 whitespace-nowrap text-destructive">
              {t('{{count}} failed', { count: failedCount })}
            </span>
          ) : undefined
        }
        running={running}
        expanded={item.expanded}
        title={explore?.goal}
        onToggle={() => {
          if (explore?.steps) onToggle?.(exploreStepsKey(item.key));
          onToggle?.(item.key);
        }}
      />
    </div>
  );
  if (!explore || !item.expanded) return head;
  // 探索组首层展开只给目标与结果，过程另开一层才平铺原始行
  return (
    <>
      {head}
      <div
        data-slot="tool-details"
        className="t-acc-reveal mt-2 mb-1 overflow-hidden rounded-xl border border-border/70 bg-card text-sm"
      >
        {explore.goal && (
          <div className="border-b border-border/60 px-3 py-2">
            <div className="mb-0.5 text-[11px] text-muted-foreground">{t('Goal')}</div>
            <p className="whitespace-pre-wrap">{explore.goal}</p>
          </div>
        )}
        {explore.report && (
          <div className="border-b border-border/60 px-3 py-2">
            <div className="mb-0.5 text-[11px] text-muted-foreground">{t('Result')}</div>
            <Markdown text={explore.report} />
          </div>
        )}
        <button
          type="button"
          onClick={() => onToggle?.(exploreStepsKey(item.key))}
          className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          <ChevronRight
            className={cn('h-3 w-3 shrink-0 transition-transform', explore.steps && 'rotate-90')}
          />
          <span>{explore.steps ? t('Hide process') : t('Show process')}</span>
          <span>· {t('{{count}} tool calls', { count: item.count })}</span>
        </button>
      </div>
    </>
  );
}

/** 工具详情独立跟随底部：用户上滚时暂停，滚回底部后恢复。 */
function ToolContentScroller({
  children,
  className,
  follow,
}: {
  children: ReactNode;
  className?: string;
  follow: boolean;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const followingRef = useRef(follow);
  const followEnabledRef = useRef(follow);
  const programmaticTargetRef = useRef<number | null>(null);
  const touchYRef = useRef<number | null>(null);
  const frameRef = useRef(0);
  followEnabledRef.current = follow;

  const pauseFollowing = useCallback(() => {
    followingRef.current = false;
    programmaticTargetRef.current = null;
    cancelAnimationFrame(frameRef.current);
  }, []);
  const pinToBottom = useCallback(() => {
    if (!followEnabledRef.current || !followingRef.current) return;
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      const scroller = scrollerRef.current;
      if (!scroller || !followEnabledRef.current || !followingRef.current) return;
      const target = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      programmaticTargetRef.current = target;
      scroller.scrollTop = target;
    });
  }, []);

  useEffect(() => {
    if (follow) {
      followingRef.current = true;
      pinToBottom();
    } else {
      programmaticTargetRef.current = null;
      cancelAnimationFrame(frameRef.current);
    }
  }, [follow, pinToBottom]);
  useEffect(pinToBottom);
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const observer = new ResizeObserver(pinToBottom);
    observer.observe(content);
    return () => observer.disconnect();
  }, [pinToBottom]);
  useEffect(() => () => cancelAnimationFrame(frameRef.current), []);

  return (
    <div
      ref={scrollerRef}
      onWheel={(event) => {
        if (event.deltaY < 0) pauseFollowing();
      }}
      onPointerDown={(event) => {
        if (event.target !== event.currentTarget) return;
        pauseFollowing();
      }}
      onTouchStart={(event) => {
        touchYRef.current = event.touches[0]?.clientY ?? null;
      }}
      onTouchMove={(event) => {
        const y = event.touches[0]?.clientY;
        if (y !== undefined && touchYRef.current !== null && y > touchYRef.current) {
          pauseFollowing();
        }
        touchYRef.current = y ?? null;
      }}
      onTouchEnd={() => {
        touchYRef.current = null;
      }}
      onScroll={(event) => {
        if (!followEnabledRef.current) return;
        const scroller = event.currentTarget;
        const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 2;
        if (atBottom) {
          followingRef.current = true;
          programmaticTargetRef.current = null;
          return;
        }
        const target = programmaticTargetRef.current;
        if (target !== null && scroller.scrollTop >= target - 2) {
          programmaticTargetRef.current = null;
          pinToBottom();
          return;
        }
        pauseFollowing();
      }}
      className={cn('scroll-stable max-h-96 overflow-auto [overflow-anchor:none]', className)}
    >
      <div ref={contentRef}>{children}</div>
    </div>
  );
}

function formatSandboxValue(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2) ?? '';
  } catch {
    return String(value);
  }
}

function SandboxOutput({
  source,
  output,
  view,
}: {
  source?: string | null;
  output: string | null;
  view: SandboxView | null;
}) {
  const value =
    view?.status === 'completed' ? formatSandboxValue(view.value) : (view?.error ?? output);
  return (
    <div className="space-y-1 px-3 py-1">
      {source ? <CodeBlock code={source} language="javascript" /> : null}
      {view && view.calls.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {[...new Map(view.calls.map((call) => [call.name, call])).keys()].map((name) => {
            const group = view.calls.filter((call) => call.name === name);
            const failed = group.find((call) => !call.ok);
            const label = `${name} ×${group.length}`;
            return (
              <span
                key={name}
                className={cn(
                  'rounded-md border px-1.5 py-0.5 font-mono text-[10px]',
                  failed ? 'border-destructive/40 text-destructive' : 'text-muted-foreground'
                )}
                title={group
                  .map((call) => call.summary)
                  .filter(Boolean)
                  .join('\n')}
              >
                {failed ? `${label} · ${failed.error ?? 'error'}` : label}
              </span>
            );
          })}
        </div>
      ) : null}
      {value ? (
        view?.status === 'completed' && typeof view.value !== 'string' ? (
          <CodeBlock code={value} language="json" />
        ) : (
          <pre className="font-mono text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">
            {stripAnsi(value)}
          </pre>
        )
      ) : null}
    </div>
  );
}

/** read 图片：按原文件渲染，限制最大边，点开看全图。加载失败时退回文本详情 */
export function ReadImagePreview({ path, fallback }: { path: string; fallback: ReactNode }) {
  const [failed, setFailed] = useState(false);
  if (failed) return fallback;
  return (
    <div data-slot="read-image" className="w-full min-w-0 px-3 py-3">
      <ZoomableImage
        src={toLocalImageUrl(path)}
        onError={() => setFailed(true)}
        frameClassName="block w-full"
        className="mx-auto block max-h-80 max-w-full rounded-md bg-muted/40 object-contain"
      />
    </div>
  );
}

/** 单行工具摘要：状态点/图标 + 工具名 + 参数摘要；edit 展开为 diff,write 展开为写入内容,其余为输出 */
function ToolRow({ item }: { item: Extract<TimelineItem, { kind: 'tool' }> }) {
  const { t } = useI18n();
  const host = useChatHost();
  const parentId = useContext(ChatSessionContext) ?? host?.sessionId;
  const { openableAgentIds, openAgent } = useSubagentProcess(parentId, item.subagentAgentIds ?? []);
  const singleAgentId =
    item.subagentAgentIds?.length === 1 && item.subagentOp !== 'wait' && item.subagentOp !== 'list'
      ? item.subagentAgentIds[0]
      : undefined;
  const activateAgent =
    singleAgentId && openableAgentIds.has(singleAgentId)
      ? () => openAgent(singleAgentId)
      : undefined;
  const compactReadOnly = useSettingsStore((s) => s.compactReadOnlyTools);
  const expandLiveEdits = useSettingsStore((s) => s.expandLiveEdits);
  const compact = compactReadOnly && item.name !== 'bash' && isReadOnlyTool(item);
  const hasDiff = Boolean(item.edits && item.edits.length > 0);
  const hasWrite = Boolean(item.writeContent);
  const hasFileChanges = Boolean(item.fileChanges && item.fileChanges.length > 0);
  const sandbox = item.sandbox ?? null;
  // 消息类工具展开显示发出的正文（投递回执已在 timeline 剥掉）；出错时只显示错误输出
  const sentMessage = item.state === 'error' ? null : item.sentMessage;
  const hasImage = Boolean(item.imagePath) && item.state !== 'error';
  const mcp = parseMcpToolName(item.name);
  // 子代理按 id 指代的操作：动作词在前，长标题截断时动作仍可见
  const summary = item.subagentOp
    ? [t(SUBAGENT_OP_LABEL_KEYS[item.subagentOp]), item.summary].filter(Boolean).join(' · ')
    : item.summary;
  const headerSummary =
    item.nestedPending && item.state === 'running'
      ? `${summary} · ${item.nestedPending} pending`
      : sandbox?.calls.length && item.state !== 'error'
        ? summarizeSandboxCalls(sandbox.calls)
        : summary;
  const hasBody = Boolean(item.output || item.source || sentMessage || item.ask);
  // 子代理等待行：运行中可展开看在等的子代理各自在干什么
  const waitProgress = item.state === 'running' && item.waiting === 'subagent' && !host;
  const expandable = hasDiff || hasWrite || hasFileChanges || hasBody || waitProgress || hasImage;
  // edit 的 diff 与 write 的内容只在本轮直播（running）且开启 expandLiveEdits 时默认展开；
  // 历史会话挂载时全部折叠——否则切会话时视口内成排 FileDiff 同步解析+高亮，
  // 主线程阻塞几秒白屏
  const autoExpand =
    expandLiveEdits && (hasDiff || hasWrite || hasImage) && item.state === 'running';
  const [expanded, setExpanded] = useState(autoExpand);
  const memoryHits =
    expanded && item.name === 'memory_search' ? parseMemorySearchHits(item.output) : null;
  const memoryCapture =
    expanded && item.name === 'memory_capture'
      ? parseMemoryCapture(item.output, item.memoryContent)
      : null;
  const subagentReceipt =
    expanded && item.name === 'subagent' && item.state !== 'error'
      ? parseSubagentReceipt(item.subagentOp, item.output)
      : null;
  const previouslyHadFileChanges = useRef(hasFileChanges);
  // apply_patch 只在终态结果中拿到真实 diff：必须按「本行从无到有」识别直播，历史首次挂载不展开。
  useEffect(() => {
    const appliedChangesArrived = shouldAutoExpandAppliedFileChanges(
      item,
      previouslyHadFileChanges.current
    );
    previouslyHadFileChanges.current = hasFileChanges;
    if (autoExpand || (expandLiveEdits && appliedChangesArrived)) setExpanded(true);
  }, [autoExpand, expandLiveEdits, hasFileChanges, item]);

  if (item.todos) return <TodoRow todos={item.todos} />;
  if (item.name.startsWith('goal_')) return <GoalSignalRow item={item} />;
  if (item.plan && item.state !== 'error') return <PlanRow plan={item.plan} />;

  const busy = item.state === 'running' || item.state === 'reviewing';
  const failed = item.state === 'error';
  const delta = toolLineDelta(item);
  const status = (
    <>
      {item.backgroundTaskId && (
        <span className="shrink-0 whitespace-nowrap" title={item.backgroundTaskId}>
          {t('Moved to background')}
        </span>
      )}
      {item.state === 'reviewing' && (
        <span
          className="t-shimmer shrink-0 whitespace-nowrap"
          data-text={t('Assistant reviewing…')}
        >
          {t('Assistant reviewing…')}
        </span>
      )}
      {item.agentMeta && (
        <span className="shrink-0 whitespace-nowrap font-mono text-[11px]">
          {[
            item.agentMeta.modelId,
            item.agentMeta.outputTokens ? `${item.agentMeta.outputTokens} tok` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      )}
    </>
  );
  return (
    <div
      className="group/tool"
      data-tool-style={compact ? 'compact' : 'full'}
      data-tool-nested={item.nested ? '' : undefined}
    >
      <ToolSummaryRow
        icon={item.nested ? undefined : toolIcon(item.name)}
        kind={toolKindLabel(item, busy, t)}
        summary={
          failed && item.output ? (
            <span className="min-w-0 truncate text-destructive/90">
              {summary && item.name === 'apply_patch' && hasFileChanges
                ? `${headerSummary} · ${firstLine(item.output)}`
                : firstLine(item.output)}
            </span>
          ) : summary ? (
            <span className="min-w-0 truncate">{headerSummary}</span>
          ) : undefined
        }
        trailing={delta ? <DiffCount added={delta.added} removed={delta.removed} /> : undefined}
        status={status}
        running={busy}
        failed={failed}
        expanded={expanded && expandable}
        canToggle={expandable}
        title={item.summary}
        onToggle={() => setExpanded((v) => !v)}
        onActivate={activateAgent}
        actionLabel={t('View subagent process')}
        actions={
          <>
            {item.name === 'subagent' &&
              !activateAgent &&
              [...openableAgentIds].map((id) => (
                <button
                  key={id}
                  type="button"
                  title={t('View subagent process')}
                  data-subagent-open={id}
                  className="flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => openAgent(id)}
                >
                  <Bot className="size-3" />
                  {t('View process')}
                </button>
              ))}
            {item.state === 'running' && item.callId && !host && (
              <MoveToBackgroundButton callId={item.callId} waiting={Boolean(item.waiting)} />
            )}
            {!host &&
              (hasDiff || hasWrite || hasFileChanges) &&
              (item.state === 'ok' || hasFileChanges) && (
                <button
                  type="button"
                  title={t('Open in side panel')}
                  className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 opacity-0 transition-[opacity,color] group-hover/tool:opacity-100 hover:bg-muted hover:text-foreground"
                  onClick={() => addSidePanelChanges()}
                >
                  <GitCompare className="h-3 w-3" />
                </button>
              )}
          </>
        }
      />
      {expanded && expandable && (
        <div
          data-slot="tool-details"
          className="t-acc-reveal mt-2 mb-1 overflow-hidden rounded-xl border border-border/70 bg-card"
        >
          {mcp && (
            <div className="truncate border-b border-border/60 px-3 py-1 font-mono text-[10px] text-muted-foreground">
              {mcp.server}.{mcp.tool}
            </div>
          )}
          {waitProgress && (
            <SubagentWaitProgress
              agentIds={item.subagentTitles ? Object.keys(item.subagentTitles) : undefined}
            />
          )}
          {hasDiff && item.edits && (
            <ToolContentScroller follow={item.state === 'running'}>
              <EditDiff path={item.summary} blocks={item.edits} />
            </ToolContentScroller>
          )}
          {hasFileChanges && item.fileChanges && (
            <ToolContentScroller follow={item.state === 'running'}>
              {item.fileChanges.map((change, index) => (
                <div
                  key={`${change.type}:${diffCacheKey(change.path, change.oldText, change.newText)}`}
                >
                  <div
                    className={cn(
                      'flex items-center gap-2 border-border/60 px-3 py-1 font-mono text-[10px] text-muted-foreground',
                      (index > 0 || hasDiff) && 'border-t'
                    )}
                  >
                    <span className="uppercase">{change.type}</span>
                    <span className="min-w-0 flex-1 truncate" title={change.path}>
                      {change.path}
                    </span>
                    {change.truncated && <span>{t('Truncated preview')}</span>}
                  </div>
                  <EditDiff path={change.path} blocks={[change]} snapshot={change} />
                </div>
              ))}
            </ToolContentScroller>
          )}
          {shouldShowToolOutputAfterFileChanges(item) && (
            <ToolContentScroller follow={false} className="border-t border-border/60">
              <pre className="px-3 py-2 font-mono text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">
                {stripAnsi(item.output ?? '')}
              </pre>
            </ToolContentScroller>
          )}
          {hasWrite && item.writeContent && (
            <ToolContentScroller
              follow={item.state === 'running'}
              className={cn((hasDiff || hasFileChanges) && 'border-t border-border/60')}
            >
              <ReadFileView path={item.summary} contents={item.writeContent} />
            </ToolContentScroller>
          )}
          {!hasDiff && !hasWrite && !hasFileChanges && (hasBody || hasImage) && (
            <ToolContentScroller follow={item.state === 'running'}>
              {isSandboxTool(item.name) ? (
                <SandboxOutput source={item.source} output={item.output} view={sandbox} />
              ) : item.name === 'bash' ? (
                <TerminalOutput command={item.summary} output={item.output ?? ''} />
              ) : item.name === 'read' && hasImage && item.imagePath ? (
                <ReadImagePreview
                  key={item.imagePath}
                  path={item.imagePath}
                  fallback={<ReadFileView path={item.summary} contents={item.output ?? ''} />}
                />
              ) : item.name === 'read' ? (
                <ReadFileView path={item.summary} contents={item.output ?? ''} />
              ) : item.name === 'subagent' &&
                item.state !== 'error' &&
                !sentMessage &&
                !subagentReceipt ? (
                <div className="px-3 py-2 text-sm">
                  <Markdown text={item.output ?? ''} />
                </div>
              ) : memoryHits ? (
                <MemorySearchResults hits={memoryHits} />
              ) : memoryCapture ? (
                <MemoryCaptureResult view={memoryCapture} />
              ) : (
                <>
                  {item.ask && <AskUserResult ask={item.ask} waiting={item.state === 'running'} />}
                  {sentMessage && (
                    <div className="px-3 py-2 text-sm">
                      <Markdown text={sentMessage} />
                    </div>
                  )}
                  {subagentReceipt ? (
                    <SubagentResult
                      view={subagentReceipt}
                      titles={item.subagentTitles}
                      onOpenAgent={openAgent}
                      openableAgentIds={openableAgentIds}
                    />
                  ) : (
                    item.output && (
                      <pre className="px-3 py-2 font-mono text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">
                        {stripAnsi(item.output)}
                      </pre>
                    )
                  )}
                </>
              )}
              <RtkToolStatsBar value={item.rtk} />
            </ToolContentScroller>
          )}
        </div>
      )}
    </div>
  );
}

/** goal 终止信号行:目标完成/受阻/等待的醒目标记(摘要即 agent 给的证据/原因) */
function GoalSignalRow({ item }: { item: Extract<TimelineItem, { kind: 'tool' }> }) {
  const { t } = useI18n();
  const kind = item.name.replace('goal_', '');
  const label =
    kind === 'complete'
      ? t('Goal completed')
      : kind === 'blocked'
        ? t('Goal blocked')
        : t('Goal waiting');
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-lg border px-3 py-2 text-sm',
        kind === 'complete' && 'border-green-500/50 bg-green-500/5',
        kind === 'blocked' && 'border-destructive/50 bg-destructive/5',
        kind === 'wait' && 'border-amber-500/50 bg-amber-500/5'
      )}
    >
      <Target
        className={cn(
          'mt-0.5 h-4 w-4 shrink-0',
          kind === 'complete' && 'text-green-600 dark:text-green-500',
          kind === 'blocked' && 'text-destructive',
          kind === 'wait' && 'text-amber-500'
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{label}</p>
        {item.summary && (
          <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground text-xs">{item.summary}</p>
        )}
      </div>
    </div>
  );
}

/** todo 清单行：进度摘要 + ✓/●/○ 列表；清单即产物，恒展开 */
function PlanRow({ plan }: { plan: { title: string; text: string } }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full min-w-0 items-center gap-2 text-left text-xs"
      >
        <ClipboardList className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="shrink-0 font-medium text-muted-foreground">{t('Plan')}</span>
        <span className="min-w-0 flex-1 truncate">{plan.title}</span>
        <ChevronRight
          className={cn(
            'h-3 w-3 shrink-0 text-muted-foreground transition-transform',
            expanded && 'rotate-90'
          )}
        />
      </button>
      {expanded && (
        <div className="mt-2 border-border/60 border-t pt-2 text-sm">
          <Markdown text={plan.text} />
        </div>
      )}
    </div>
  );
}

function TodoRow({ todos }: { todos: TodoItem[] }) {
  const { t } = useI18n();
  const done = todos.filter((todo) => todo.status === 'completed').length;
  return (
    <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
      <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
        <ListTodo className="h-3.5 w-3.5 shrink-0" />
        <span className="font-medium">{t('Todos')}</span>
        <span>
          {done}/{todos.length}
        </span>
      </div>
      <TodoList todos={todos} />
    </div>
  );
}

/** 运行中的前台命令移交为后台任务，或结束阻塞等待（被等的继续跑）；worker 拒绝时稍后恢复可点 */
function MoveToBackgroundButton({ callId, waiting }: { callId: string; waiting: boolean }) {
  const { t } = useI18n();
  const sessionId = useSessionsStore((state) => displayedConversation(state)?.id ?? '');
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => setPending(false), 5000);
    return () => clearTimeout(timer);
  }, [pending]);
  if (!sessionId) return null;
  const label = waiting
    ? pending
      ? t('Stopping wait…')
      : t('Stop waiting')
    : pending
      ? t('Moving to background…')
      : t('Move to background');
  const Icon = waiting ? SkipForward : ArrowDownToLine;
  return (
    <button
      type="button"
      disabled={pending}
      title={label}
      className="flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
      onClick={() => {
        setPending(true);
        void window.electronAPI.agent.backgroundTool(sessionId, callId).then(
          (result) => {
            if (!result.ok) setPending(false);
          },
          () => setPending(false)
        );
      }}
    >
      <Icon className="h-3 w-3" />
      {label}
    </button>
  );
}

/** 主路径是 Main 推送；慢速轮询只做自愈兜底（推送链路任一环断了也能收敛） */
const WAIT_PROGRESS_POLL_MS = 5000;
const NO_RUNS: AgentRunProgress[] = [];

function runActivityLabel(run: AgentRunProgress, t: TFunction): string {
  if (run.status === 'queued') return t('Queued');
  const activity = run.activity;
  if (activity?.phase === 'tool') return [activity.tool, activity.detail].filter(Boolean).join(' ');
  return activity?.phase === 'writing' ? t('Writing reply…') : t('Thinking…');
}

/** 子代理等待行展开：在等的子代理各自在干什么、跑了多久、最近说了什么（Main 推送 + 兜底轮询） */
function SubagentWaitProgress({ agentIds }: { agentIds?: string[] }) {
  const { t } = useI18n();
  const sessionId = useSessionsStore((state) => displayedConversation(state)?.id ?? '');
  const runs = useSubagentRunsStore((state) => state.byConversation[sessionId] ?? NO_RUNS);
  const { openableAgentIds, openAgent } = useSubagentProcess(
    sessionId,
    runs.map((run) => run.agentId)
  );
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!sessionId) return;
    let alive = true;
    const replace = (next: AgentRunProgress[]) => {
      if (!alive) return;
      useSubagentRunsStore.getState().replace(sessionId, next);
      setLoaded(true);
    };
    const load = () => {
      const revision = useSubagentRunsStore.getState().revisionByConversation[sessionId] ?? 0;
      return window.electronAPI.agent.subagentProgress(sessionId).then(
        (next) => {
          if ((useSubagentRunsStore.getState().revisionByConversation[sessionId] ?? 0) === revision)
            replace(next);
        },
        () => {}
      );
    };
    const unsubscribe = window.electronAPI.agent.onSubagentProgress((push) => {
      if (push.sessionId === sessionId) replace(push.runs);
    });
    void load();
    const timer = setInterval(load, WAIT_PROGRESS_POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
      unsubscribe();
    };
  }, [sessionId]);
  if (!loaded) return null;
  // wait 只列它等的子代理；spawn / send 带 wait 时行上没有 agentId，列出全部在跑的
  const visible = agentIds?.length ? runs.filter((run) => agentIds.includes(run.agentId)) : runs;
  return (
    <div className="border-b border-border/60 px-3 py-2 text-xs">
      {visible.length === 0 ? (
        <div className="text-muted-foreground">{t('No running subagents')}</div>
      ) : (
        visible.map((run) => (
          <div key={run.runId} className="py-0.5">
            <div className="flex items-center gap-2">
              <span className="max-w-[40%] shrink-0 truncate font-medium">
                {run.title ?? run.agentId.slice(0, 8)}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">
                {runActivityLabel(run, t)}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70 tabular-nums">
                {formatDuration(run.elapsedMs)}
              </span>
              {openableAgentIds.has(run.agentId) && (
                <button
                  type="button"
                  onClick={() => openAgent(run.agentId)}
                  className="shrink-0 rounded px-1.5 py-0.5 hover:bg-muted"
                >
                  {t('View process')}
                </button>
              )}
            </div>
            {run.text && (
              <div className="line-clamp-2 break-words pl-2 text-[11px] text-muted-foreground/80">
                {run.text.replace(/\s+/g, ' ')}
              </div>
            )}
          </div>
        ))
      )}
      <div className="mt-1 text-[11px] text-muted-foreground/80">
        {t(
          'Stopping the wait does not stop subagents; the assistant is notified when they finish.'
        )}
      </div>
    </div>
  );
}

function toolIcon(name: string): LucideIcon {
  if (name === 'read') return FileText;
  if (name === 'ls') return FolderOpen;
  if (name === 'grep' || name === 'find' || name === 'glob' || name === 'code_search')
    return Search;
  if (name === 'bash' || name === 'powershell' || name === 'task_output') return TerminalSquare;
  if (name === 'edit' || name === 'apply_patch') return Pencil;
  if (name === 'write') return FilePlus;
  if (isSandboxTool(name)) return BoxSelect;
  if (name === 'subagent') return Bot;
  if (name.includes('web') || name.includes('fetch')) return Globe;
  return Wrench;
}

type ToolKind = 'read' | 'search' | 'edit' | 'write' | 'terminal' | null;

function toolKind(name: string): ToolKind {
  if (name === 'read') return 'read';
  if (
    name === 'ls' ||
    name === 'grep' ||
    name === 'find' ||
    name === 'glob' ||
    name === 'code_search'
  )
    return 'search';
  if (name === 'edit' || name === 'apply_patch') return 'edit';
  if (name === 'write') return 'write';
  if (name === 'bash' || name === 'powershell') return 'terminal';
  return null;
}

const KIND_LABEL: Record<NonNullable<ToolKind>, [done: string, running: string]> = {
  read: ['Read file', 'Reading'],
  search: ['Search', 'Searching'],
  edit: ['Edited', 'Editing'],
  write: ['Wrote', 'Writing'],
  terminal: ['Terminal', 'Executing'],
};

/** 工具行的类型词（对齐 ZCode：读取 / 搜索 / 编辑 / 终端，运行中换成「正在…」） */
function toolKindLabel(
  item: Extract<TimelineItem, { kind: 'tool' }>,
  busy: boolean,
  t: TFunction
): string {
  const kind = toolKind(item.name);
  if (kind) return t(KIND_LABEL[kind][busy ? 1 : 0]);
  const mcp = parseMcpToolName(item.name);
  return TOOL_LABEL_KEYS[item.name] ? toolLabel(item.name, t) : (mcp?.tool ?? item.name);
}

const firstLine = (text: string): string => stripAnsi(text.split('\n', 1)[0] ?? '');
