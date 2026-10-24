import type {
  BackgroundTaskInfo,
  SubagentActivity,
  SubagentInfo,
  TodoItem,
} from '@shared/types/agent';
import { modelDisplayName } from '@shared/virtualModels';
import {
  Ban,
  Bot,
  Check,
  ChevronRight,
  CircleAlert,
  Clock,
  FileText,
  ListTodo,
  LoaderCircle,
  Search,
  Square,
  Terminal,
  TerminalSquare,
  Wrench,
  X,
} from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useSubagentDirectory } from '@/hooks/useSubagentDirectory';
import { useI18n } from '@/i18n';
import { parseMcpToolName, unwrapMcpProxyCall } from '@/lib/mcpToolName';
import { addSidePanelSubagent, addSidePanelSubagentDirectory } from '@/lib/sidePanelDock';
import { resolveSubagentTarget, type SubagentDirectoryEntry } from '@/lib/subagentTargets';
import { stripAnsi } from '@/lib/terminalText';
import { cn } from '@/lib/utils';
import { useSessionsStore } from '@/stores/sessions';
import { formatDuration } from '@/stores/sessions/stats';
import { useSettingsStore } from '@/stores/settings';
import { Markdown } from './Markdown';
import { StepNode } from './StepNode';
import { summarizeSubagentToolArgs } from './subagentToolSummary';
import { TodoList } from './TodoBar';
import { shouldFollowTaskBarOutput } from './taskBarScroll';
import {
  agentCardTitle,
  agentDockSummary,
  agentDurationMs,
  bashDockSummary,
  DOCK_FILTERS,
  type DockFilter,
  type DockSummary,
  defaultDockFilter,
  filterDockAgents,
  filterDockTasks,
  isDockAgentRunning,
  spawnBriefs,
  type TodoDockSummary,
  todoDockSummary,
} from './taskDock';

interface TaskBarProps {
  sessionId: string;
  tasks: BackgroundTaskInfo[];
  /** 旧版 worker / 远程节点推送的子代理行；本机子代理以持久目录为准 */
  subagents: SubagentInfo[];
  /** 手机只读配对：停止会被 host 拦截，不给按钮 */
  readOnly?: boolean;
  /** 最新仍有未完成项的任务清单（「当前进度」按钮）；缺省不显示 */
  todos?: { id: string; todos: TodoItem[] } | null;
}

type DockKind = 'bash' | 'agent' | 'todo';

/**
 * 输入框上方的固定按钮条：「后台 Bash」「后台 Agent」「当前进度」各一枚，任务再多也只占一行。
 * 按钮直接带运行数与失败红点；点开在输入框上方弹出列表，可在「运行中 / 全部」间切换。
 * 子代理入口来自持久 child metadata：会话派过子代理就保留，全部结束后仍可回看。
 */
export function TaskBar({ sessionId, tasks, subagents, readOnly, todos }: TaskBarProps) {
  const { t } = useI18n();
  const directory = useSubagentDirectory(sessionId);
  const [open, setOpen] = useState<DockKind | null>(null);
  const bash = bashDockSummary(tasks);
  const progress = todoDockSummary(todos);
  // 远程节点没有本机 child 会话，只有推送行；目录为空时退回推送行
  const legacyAgents = directory.length === 0 ? subagents : [];
  const agents =
    agentDockSummary(directory) ??
    (legacyAgents.length > 0
      ? {
          total: legacyAgents.length,
          running: legacyAgents.filter((agent) => agent.status === 'running').length,
          failed: legacyAgents.filter((agent) => agent.status === 'failed').length,
        }
      : null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!bash && !agents && !progress) return null;
  const toggle = (kind: DockKind) => setOpen((current) => (current === kind ? null : kind));

  return (
    <div ref={ref} className="relative mb-1.5" data-task-dock="">
      {open === 'todo' && progress && todos && (
        <TodoPanel summary={progress} todos={todos.todos} onClose={() => setOpen(null)} />
      )}
      {open === 'bash' && bash && (
        <DockPanel
          icon={TerminalSquare}
          title={t('Background Bash')}
          summary={bash}
          onClose={() => setOpen(null)}
        >
          {(filter) => (
            <BashList
              sessionId={sessionId}
              tasks={filterDockTasks(tasks, filter)}
              readOnly={readOnly}
            />
          )}
        </DockPanel>
      )}
      {open === 'agent' && agents && (
        <DockPanel
          icon={Bot}
          title={t('Background Agent')}
          summary={agents}
          onClose={() => setOpen(null)}
          onOpenDirectory={
            directory.length > 0 ? () => addSidePanelSubagentDirectory(sessionId) : undefined
          }
        >
          {(filter) =>
            directory.length > 0 ? (
              <AgentCards
                sessionId={sessionId}
                entries={filterDockAgents(directory, filter)}
                order={directory.map((entry) => entry.agentId)}
              />
            ) : (
              <LegacyAgentList
                sessionId={sessionId}
                agents={legacyAgents.filter(
                  (agent) => filter === 'all' || agent.status === 'running'
                )}
                readOnly={readOnly}
              />
            )
          }
        </DockPanel>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {bash && (
          <DockButton
            kind="bash"
            icon={TerminalSquare}
            label={t('Background Bash')}
            summary={bash}
            open={open === 'bash'}
            onClick={() => toggle('bash')}
          />
        )}
        {agents && (
          <DockButton
            kind="agent"
            icon={Bot}
            label={t('Background Agent')}
            summary={agents}
            open={open === 'agent'}
            onClick={() => toggle('agent')}
          />
        )}
        {progress && (
          <button
            type="button"
            data-task-dock-button="todo"
            aria-expanded={open === 'todo'}
            onClick={() => toggle('todo')}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-lg border bg-card px-2.5 text-xs text-muted-foreground shadow-xs transition-colors hover:bg-muted hover:text-foreground',
              open === 'todo' && 'bg-muted text-foreground'
            )}
          >
            {progress.active ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <ListTodo className="h-3.5 w-3.5" aria-hidden />
            )}
            <span>{t('Current progress')}</span>
            <span className="tabular-nums">
              {progress.done}/{progress.total}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}

/** 「当前进度」弹层：完整清单，无筛选（清单本身就是整表） */
function TodoPanel({
  summary,
  todos,
  onClose,
}: {
  summary: TodoDockSummary;
  todos: TodoItem[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="absolute bottom-full left-0 right-0 z-30 mb-1.5 flex max-h-[min(28rem,60vh)] flex-col rounded-xl border bg-card shadow-float">
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2 text-xs">
        <ListTodo className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        <span className="font-medium text-foreground">{t('Current progress')}</span>
        <span className="text-muted-foreground tabular-nums">
          {summary.done}/{summary.total}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="scroll-stable min-h-0 flex-1 overflow-auto px-3 py-2">
        <TodoList todos={todos} />
      </div>
    </div>
  );
}

function DockButton({
  kind,
  icon: Icon,
  label,
  summary,
  open,
  onClick,
}: {
  kind: DockKind;
  icon: typeof Bot;
  label: string;
  summary: DockSummary;
  open: boolean;
  onClick: () => void;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      data-task-dock-button={kind}
      aria-expanded={open}
      onClick={onClick}
      title={summary.running > 0 ? t('{{count}} running', { count: summary.running }) : undefined}
      className={cn(
        'relative inline-flex h-7 items-center gap-1.5 rounded-lg border bg-card px-2.5 text-xs text-muted-foreground shadow-xs transition-colors hover:bg-muted hover:text-foreground',
        open && 'bg-muted text-foreground'
      )}
    >
      {summary.running > 0 ? (
        <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />
      ) : (
        <Icon className="h-3.5 w-3.5" aria-hidden />
      )}
      <span>{label}</span>
      {summary.running > 0 && <span className="tabular-nums">· {summary.running}</span>}
      {summary.failed > 0 && (
        <span
          data-task-dock-failed=""
          role="img"
          aria-label={t('Failed')}
          className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-destructive"
        />
      )}
    </button>
  );
}

function DockPanel({
  icon: Icon,
  title,
  summary,
  onClose,
  onOpenDirectory,
  children,
}: {
  icon: typeof Bot;
  title: string;
  summary: DockSummary;
  onClose: () => void;
  onOpenDirectory?: () => void;
  children: (filter: DockFilter) => ReactNode;
}) {
  const { t } = useI18n();
  const [filter, setFilter] = useState<DockFilter>(() => defaultDockFilter(summary.running));
  const filterLabel: Record<DockFilter, string> = {
    recent: t('Recent'),
    running: t('In progress'),
    done: t('Completed'),
    all: t('All'),
  };
  return (
    <div
      data-task-dock-panel=""
      className="absolute bottom-full left-0 right-0 z-30 mb-1.5 flex h-[min(20rem,55vh)] flex-col rounded-xl border bg-card shadow-float"
    >
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2 text-xs">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        <span className="font-medium text-foreground">{title}</span>
        <span className="text-muted-foreground tabular-nums">
          {t('{{count}} running', { count: summary.running })}
        </span>
        <div className="ml-auto flex items-center gap-0.5 rounded-lg bg-muted p-0.5" role="tablist">
          {DOCK_FILTERS.map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={filter === value}
              data-task-dock-filter={value}
              onClick={() => setFilter(value)}
              className={cn(
                'rounded-md px-2 py-0.5 text-muted-foreground transition-colors hover:text-foreground',
                filter === value && 'bg-background text-foreground shadow-xs'
              )}
            >
              {filterLabel[value]}
            </button>
          ))}
        </div>
        {onOpenDirectory && (
          <button
            type="button"
            onClick={() => {
              onOpenDirectory();
              onClose();
            }}
            title={t('Agents')}
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="scroll-stable min-h-0 flex-1 overflow-auto p-1.5">{children(filter)}</div>
    </div>
  );
}

function EmptyDock() {
  const { t } = useI18n();
  return (
    <p className="px-2 py-6 text-center text-xs text-muted-foreground">{t('Nothing running.')}</p>
  );
}

function BashList({
  sessionId,
  tasks,
  readOnly,
}: {
  sessionId: string;
  tasks: BackgroundTaskInfo[];
  readOnly?: boolean;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState<string | null>(null);
  if (tasks.length === 0) return <EmptyDock />;
  return (
    <div className="flex flex-col gap-0.5">
      {tasks.map((task) => (
        <div key={task.taskId}>
          <div className="flex min-h-[30px] min-w-0 items-center gap-2 rounded-md px-1.5 text-[13px] hover:bg-muted/50">
            <StepNode
              icon={TerminalSquare}
              state={
                task.status === 'running' ? 'running' : task.status === 'failed' ? 'error' : 'ok'
              }
            />
            <button
              type="button"
              aria-expanded={expanded === task.taskId}
              onClick={() => setExpanded(expanded === task.taskId ? null : task.taskId)}
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
            >
              <span
                className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
                title={task.command}
              >
                $ {task.command}
              </span>
              <TaskMeta task={task} />
              <ChevronRight
                className={cn(
                  'h-3 w-3 shrink-0 text-muted-foreground transition-transform',
                  expanded === task.taskId && 'rotate-90'
                )}
              />
            </button>
            {task.status === 'running' && !readOnly && (
              <button
                type="button"
                onClick={() => void window.electronAPI.agent.stopTask(sessionId, task.taskId)}
                title={t('Stop task')}
                className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <Square className="h-3 w-3" />
              </button>
            )}
          </div>
          {expanded === task.taskId && <TailView tail={task.tail} />}
        </div>
      ))}
    </div>
  );
}

function AgentCards({
  sessionId,
  entries,
  order,
}: {
  sessionId: string;
  entries: SubagentDirectoryEntry[];
  /** 全部子代理按派发先后的 agentId，决定卡片序号，不随筛选变化 */
  order: string[];
}) {
  const { t } = useI18n();
  const virtualModels = useSettingsStore((state) => state.virtualModels);
  const messages = useSessionsStore((state) => state.conversations[sessionId]?.messages);
  const briefs = useMemo(() => spawnBriefs(messages ?? []), [messages]);
  const anyRunning = entries.some(isDockAgentRunning);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!anyRunning) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [anyRunning]);
  if (entries.length === 0) return <EmptyDock />;
  const statusLabel = (entry: SubagentDirectoryEntry) =>
    isDockAgentRunning(entry)
      ? t('Running')
      : entry.status === 'failed'
        ? t('Failed')
        : entry.mode === 'coworker' && !entry.closed
          ? t('Collaborator standing by')
          : entry.status === 'cancelled'
            ? t('Cancelled')
            : t('Completed');
  return (
    <div className="grid grid-cols-1 gap-1.5 @md:grid-cols-2 @2xl:grid-cols-3">
      {entries.map((entry) => {
        const running = isDockAgentRunning(entry);
        const index = order.indexOf(entry.agentId);
        const title = agentCardTitle(entry.title);
        const brief = briefs.get(entry.agentId);
        const duration = agentDurationMs({ ...entry, running }, now);
        return (
          <button
            key={entry.childConversationId}
            type="button"
            data-subagent-open={entry.agentId}
            title={t('View process')}
            onClick={() => {
              const target = resolveSubagentTarget(
                useSessionsStore.getState().conversations,
                sessionId,
                entry.agentId
              );
              if (target) addSidePanelSubagent(target);
            }}
            className="flex min-w-0 flex-col gap-1.5 rounded-lg bg-muted/50 px-3 py-2.5 text-left text-xs transition-colors hover:bg-muted"
          >
            <span className="flex min-w-0 items-baseline gap-1.5">
              {index >= 0 && (
                <span className="shrink-0 font-mono text-muted-foreground tabular-nums">
                  {String(index + 1).padStart(2, '0')}
                </span>
              )}
              <span className="truncate text-sm font-medium text-foreground" title={entry.title}>
                {title}
              </span>
            </span>
            <span
              data-subagent-brief=""
              className="line-clamp-2 min-h-[2lh] text-muted-foreground"
              title={brief}
            >
              {brief ?? (entry.mode === 'task' ? t('One-off task') : t('Persistent collaborator'))}
            </span>
            {entry.modelId && (
              <span className="flex min-w-0 items-center gap-1 text-muted-foreground">
                <Bot className="h-3 w-3 shrink-0" aria-hidden />
                <span className="truncate">{modelDisplayName(virtualModels, entry.modelId)}</span>
              </span>
            )}
            <span
              className={cn(
                'flex items-center gap-1',
                entry.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'
              )}
            >
              {running ? (
                <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden />
              ) : entry.status === 'failed' ? (
                <CircleAlert className="h-3 w-3" aria-hidden />
              ) : (
                <Check className="h-3 w-3" aria-hidden />
              )}
              {statusLabel(entry)}
              {duration !== undefined && (
                <span className="ml-auto flex items-center gap-1 text-muted-foreground tabular-nums">
                  <Clock className="h-3 w-3" aria-hidden />
                  {formatDuration(duration)}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** 远程节点没有本机 child 会话：沿用推送行，点开内嵌查看活动与报告 */
function LegacyAgentList({
  sessionId,
  agents,
  readOnly,
}: {
  sessionId: string;
  agents: SubagentInfo[];
  readOnly?: boolean;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState<string | null>(null);
  if (agents.length === 0) return <EmptyDock />;
  return (
    <div className="flex flex-col gap-0.5">
      {agents.map((agent) => (
        <div key={agent.id}>
          <div className="flex min-h-[30px] min-w-0 items-center gap-2 rounded-md px-1.5 text-[13px] hover:bg-muted/50">
            <StepNode
              icon={Bot}
              state={
                agent.status === 'running' ? 'running' : agent.status === 'failed' ? 'error' : 'ok'
              }
            />
            <button
              type="button"
              aria-expanded={expanded === agent.id}
              onClick={() => setExpanded(expanded === agent.id ? null : agent.id)}
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
            >
              {agent.agentType && <span className="shrink-0 font-medium">{agent.agentType}</span>}
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {agent.description}
              </span>
              <AgentMeta agent={agent} />
            </button>
            {agent.status === 'running' && !readOnly && (
              <button
                type="button"
                onClick={() => void window.electronAPI.agent.stopSubagent(sessionId, agent.id)}
                title={t('Stop subagent')}
                className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <Square className="h-3 w-3" />
              </button>
            )}
          </div>
          {expanded === agent.id && <AgentDetails agent={agent} />}
        </div>
      ))}
    </div>
  );
}

function AgentDetails({ agent }: { agent: SubagentInfo }) {
  const { t } = useI18n();
  const activities = agent.activities ?? [];
  const ref = useRef<HTMLDivElement>(null);
  const followingRef = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 流式活动或终态报告变化时贴底
  useEffect(() => {
    const el = ref.current;
    if (el && followingRef.current) el.scrollTop = el.scrollHeight;
  }, [activities, agent.resultText]);
  return (
    <div
      ref={ref}
      className="scroll-stable max-h-96 space-y-2 overflow-auto px-3 py-2 text-sm"
      onScroll={(event) => {
        followingRef.current = shouldFollowTaskBarOutput(event.currentTarget);
      }}
    >
      {activities.map((activity) => (
        <AgentActivityView key={activity.id} activity={activity} />
      ))}
      {activities.length === 0 && !agent.resultText && (
        <pre className="font-mono text-xs whitespace-pre-wrap text-muted-foreground">
          {(agent.activityLog ?? []).join('\n') || t('(no output yet)')}
        </pre>
      )}
      {agent.detailsPruned && (
        <div className="rounded-md border border-dashed px-2.5 py-2 text-xs text-muted-foreground">
          {t('Earlier activity details were cleared; the final report is still available.')}
        </div>
      )}
      {agent.resultText && agent.status !== 'running' && (
        <section
          className={cn(
            'rounded-lg border px-3 py-2',
            agent.status === 'failed'
              ? 'border-destructive/30 bg-destructive/5'
              : 'border-blue-500/30 bg-blue-500/5'
          )}
        >
          <div className="mb-1.5 font-medium text-xs text-foreground">{t('Final report')}</div>
          <Markdown text={agent.resultText} />
        </section>
      )}
    </div>
  );
}

export function AgentActivityView({ activity }: { activity: SubagentActivity }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  if (activity.type === 'assistant') {
    return (
      <section className="rounded-md bg-muted/30 px-2.5 py-2">
        <div className="mb-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
          {t('Assistant')}
        </div>
        <FoldedContent text={activity.text} markdown />
      </section>
    );
  }
  const summary = summarizeSubagentToolArgs(activity.toolName, activity.argumentsText);
  const toolName = unwrapMcpProxyCall(activity.toolName, activity.argumentsText).name;
  const mcp = parseMcpToolName(toolName);
  const contentId = `subagent-tool-${activity.id.replace(/[^A-Za-z0-9_-]/g, '-')}`;
  return (
    <section className="border-b border-border/40 last:border-b-0">
      <button
        type="button"
        aria-controls={contentId}
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs transition-colors hover:bg-muted/50"
      >
        <SubagentToolIcon toolName={toolName} />
        <span className="shrink-0 font-medium text-foreground/80">{mcp?.tool ?? toolName}</span>
        {summary && (
          <span
            className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground"
            title={summary}
          >
            {summary}
          </span>
        )}
        {!summary && <span className="min-w-0 flex-1" />}
        <SubagentToolStatus status={activity.status} label={t(activity.status)} />
        <ChevronRight
          aria-hidden="true"
          className={cn(
            'h-3 w-3 shrink-0 text-muted-foreground transition-transform',
            expanded && 'rotate-90'
          )}
        />
      </button>
      {expanded && (
        <div id={contentId} className="ml-5 border-border/50 border-l pb-2 pl-2.5">
          {mcp && (
            <div className="mb-1 truncate font-mono text-[10px] text-muted-foreground/70">
              {mcp.server}.{mcp.tool}
            </div>
          )}
          <div className="text-[10px] text-muted-foreground/70">{t('Arguments')}</div>
          <pre className="scroll-stable max-h-28 overflow-auto font-mono text-[10px] leading-relaxed whitespace-pre-wrap text-muted-foreground/80">
            {stripAnsi(activity.argumentsText)}
          </pre>
          {activity.outputText && (
            <div className="mt-1.5 border-border/40 border-t pt-1.5">
              <div className="mb-0.5 text-[10px] text-muted-foreground">{t('Result')}</div>
              <pre className="overflow-auto font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-foreground/80">
                {stripAnsi(activity.outputText)}
              </pre>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function SubagentToolIcon({ toolName }: { toolName: string }) {
  const name = toolName.toLowerCase();
  const className = 'h-3.5 w-3.5 shrink-0 text-muted-foreground';
  if (name.includes('search') || name.includes('grep') || name === 'find') {
    return <Search aria-hidden="true" className={className} />;
  }
  if (
    name === 'read' ||
    name === 'write' ||
    name === 'edit' ||
    name === 'apply_patch' ||
    name.endsWith('_read')
  ) {
    return <FileText aria-hidden="true" className={className} />;
  }
  if (
    name === 'bash' ||
    name === 'exec' ||
    name === 'codemode' ||
    name.includes('shell') ||
    name.includes('terminal')
  ) {
    return <Terminal aria-hidden="true" className={className} />;
  }
  return <Wrench aria-hidden="true" className={className} />;
}

function SubagentToolStatus({
  status,
  label,
}: {
  status: Extract<SubagentActivity, { type: 'tool' }>['status'];
  label: string;
}) {
  const className = 'h-3.5 w-3.5';
  return (
    <span
      role="status"
      aria-label={label}
      title={label}
      className={cn('shrink-0', status === 'failed' ? 'text-destructive' : 'text-muted-foreground')}
    >
      {status === 'running' ? (
        <LoaderCircle aria-hidden="true" className={cn(className, 'animate-spin')} />
      ) : status === 'done' ? (
        <Check aria-hidden="true" className={className} />
      ) : status === 'failed' ? (
        <CircleAlert aria-hidden="true" className={className} />
      ) : (
        <Ban aria-hidden="true" className={className} />
      )}
    </span>
  );
}

function FoldedContent({
  text,
  label,
  markdown = false,
}: {
  text: string;
  label?: string;
  markdown?: boolean;
}) {
  const { t } = useI18n();
  const long = text.length > 800 || text.split('\n').length > 16;
  const body = markdown ? (
    <Markdown text={text} />
  ) : (
    <pre className="overflow-x-auto font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
      {stripAnsi(text)}
    </pre>
  );
  if (!long) {
    return (
      <div>
        {label && <div className="mb-0.5 text-[10px] text-muted-foreground">{label}</div>}
        {body}
      </div>
    );
  }
  return (
    <details className="group/details">
      <summary className="cursor-pointer text-[10px] text-muted-foreground hover:text-foreground">
        {label ? `${label} · ` : ''}
        {t('{{count}} chars', { count: text.length })}
      </summary>
      <div className="mt-1.5">{body}</div>
    </details>
  );
}

function AgentMeta({ agent }: { agent: SubagentInfo }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (agent.status !== 'running') return;
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [agent.status]);
  return (
    <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70 tabular-nums">
      {agent.steps > 0 ? `${agent.steps} steps · ` : ''}
      {agent.outputTokens ? `${agent.outputTokens} tok · ` : ''}
      {agent.status === 'running' ? formatDuration(Date.now() - agent.startedAt) : agent.status}
    </span>
  );
}

function TaskMeta({ task }: { task: BackgroundTaskInfo }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (task.status !== 'running') return;
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [task.status]);
  return (
    <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70 tabular-nums">
      {task.status === 'running'
        ? formatDuration(Date.now() - task.startedAt)
        : task.exitCode !== undefined
          ? `exit ${task.exitCode}`
          : task.status}
    </span>
  );
}

/** 输出尾部：等宽流式,新内容自动贴底 */
function TailView({ tail }: { tail: string }) {
  const { t } = useI18n();
  const ref = useRef<HTMLPreElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: tail 变化时贴底
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [tail]);
  return (
    <pre
      ref={ref}
      className="scroll-stable max-h-56 overflow-auto border-t border-border/60 px-2.5 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground"
    >
      {stripAnsi(tail) || t('(no output yet)')}
    </pre>
  );
}
