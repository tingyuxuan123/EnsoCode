import type { BackgroundTaskInfo, SubagentInfo, TodoItem } from '@shared/types/agent';
import {
  Bot,
  Check,
  ChevronRight,
  Circle,
  CircleAlert,
  CircleCheck,
  CircleDot,
  ListTodo,
  LoaderCircle,
  Square,
  TerminalSquare,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { Markdown } from '@/components/chat/Markdown';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { stripAnsi } from '@/lib/terminalText';
import { cn } from '@/lib/utils';
import { usePhoneBack } from './usePhoneBack';

interface Props {
  sessionId: string;
  tasks: BackgroundTaskInfo[];
  subagents: SubagentInfo[];
  /** 只读配对：停止/取消会被 host 拦下，不给按钮 */
  readOnly?: boolean;
  /** 最新仍有未完成项的任务清单；缺省不显示进度入口 */
  todos?: { id: string; todos: TodoItem[] } | null;
  /** 连接状态：离线时命令停止/Agent 取消发不出去，先不给按钮（Main 传） */
  online?: boolean;
}

type DockKind = 'bash' | 'agent' | 'todo';

export interface DockCount {
  total: number;
  running: number;
  failed: number;
}

/** 命令运行/失败统计；空列表返回 null（整条不显示） */
export function bashDockSummary(tasks: readonly BackgroundTaskInfo[]): DockCount | null {
  if (tasks.length === 0) return null;
  return {
    total: tasks.length,
    running: tasks.filter((task) => task.status === 'running').length,
    failed: tasks.filter((task) => task.status === 'failed').length,
  };
}

/** Agent 运行/失败统计；手机只有推送行，不读桌面子代理目录 */
export function agentDockSummary(agents: readonly SubagentInfo[]): DockCount | null {
  if (agents.length === 0) return null;
  return {
    total: agents.length,
    running: agents.filter((agent) => agent.status === 'running').length,
    failed: agents.filter((agent) => agent.status === 'failed').length,
  };
}

/** 「当前进度」：已完成/总数 + 是否有进行中项 */
export function todoDockState(
  list: { id: string; todos: readonly TodoItem[] } | null | undefined
): { done: number; total: number; active: boolean } | null {
  if (!list || list.todos.length === 0) return null;
  return {
    done: list.todos.filter((todo) => todo.status === 'completed').length,
    total: list.todos.length,
    active: list.todos.some((todo) => todo.status === 'in_progress'),
  };
}

const taskStatusText = (task: BackgroundTaskInfo) =>
  task.status === 'running'
    ? '运行中'
    : task.exitCode !== undefined
      ? `exit ${task.exitCode}`
      : task.status === 'failed'
        ? '失败'
        : '完成';

const agentStatusText = (agent: SubagentInfo) =>
  agent.status === 'running' ? '运行中' : agent.status === 'failed' ? '失败' : '完成';

/**
 * 手机专用后台入口（设计 session-bars.tsx）：页头一行低噪胶囊，点开走底部 Sheet。
 * 桌面 TaskBar 的弹层用 bottom-full 向上展开，在手机页头会顶出屏幕；这里不沿用。
 * 真实能力保持不变：命令/输出全文、停止命令、取消 Agent、进度清单。
 */
export function PhoneTaskBar({
  sessionId,
  tasks,
  subagents,
  readOnly,
  todos,
  online = true,
}: Props) {
  const [open, setOpen] = useState<DockKind | null>(null);
  const bash = bashDockSummary(tasks);
  const agents = agentDockSummary(subagents);
  const progress = todoDockState(todos);
  const writable = !readOnly && online;
  // 只有「当前这类还有可显示内容」才算真打开：数据归零时不能留下看不见的返回守卫
  const sheetVisible =
    (open === 'bash' && Boolean(bash)) ||
    (open === 'agent' && Boolean(agents)) ||
    (open === 'todo' && Boolean(progress));
  usePhoneBack(sheetVisible, () => setOpen(null), 55);

  if (!bash && !agents && !progress) return null;
  const close = () => setOpen(null);
  const title = open === 'bash' ? '后台命令' : open === 'agent' ? '后台 Agent' : '当前进度';

  return (
    <>
      <div data-phone-task-bar="" className="flex flex-wrap items-center gap-2">
        {bash && (
          <DockPill
            kind="bash"
            icon={TerminalSquare}
            label="后台命令"
            count={bash.running > 0 ? `· ${bash.running} 个在跑` : `· ${bash.total} 个`}
            failed={bash.failed}
            open={open === 'bash'}
            onClick={() => setOpen(open === 'bash' ? null : 'bash')}
          />
        )}
        {agents && (
          <DockPill
            kind="agent"
            icon={Bot}
            label="后台 Agent"
            count={agents.running > 0 ? `· ${agents.running} 个在跑` : `· ${agents.total} 个`}
            failed={agents.failed}
            open={open === 'agent'}
            onClick={() => setOpen(open === 'agent' ? null : 'agent')}
          />
        )}
        {progress && (
          <DockPill
            kind="todo"
            icon={ListTodo}
            label="当前进度"
            count={`${progress.done}/${progress.total}`}
            active={progress.active}
            open={open === 'todo'}
            onClick={() => setOpen(open === 'todo' ? null : 'todo')}
          />
        )}
      </div>

      <Sheet open={sheetVisible} onOpenChange={(next) => !next && close()}>
        <SheetContent
          side="bottom"
          className="phone-sheet max-h-[80dvh] pb-safe"
          showCloseButton={false}
          initialFocus={false}
        >
          <SheetHeader className="shrink-0 gap-1 px-5 pt-7 pb-3">
            <div className="flex items-center gap-3">
              <SheetTitle className="min-w-0 flex-1 text-[17px] leading-[22px] font-semibold">
                {title}
              </SheetTitle>
              <span className="shrink-0 rounded-full bg-card2 px-2.5 py-1 text-[12px] leading-4 font-medium text-ink2">
                {open === 'bash'
                  ? `${bash?.running ?? 0} 个在跑`
                  : open === 'agent'
                    ? `${agents?.running ?? 0} 个在跑`
                    : `${progress?.done ?? 0}/${progress?.total ?? 0}`}
              </span>
              <button
                type="button"
                aria-label="关闭后台面板"
                onClick={close}
                className="flex size-9 shrink-0 items-center justify-center rounded-full text-dim"
              >
                <X className="size-[18px]" aria-hidden />
              </button>
            </div>
            <p className="text-[12px] leading-4 text-dim">
              {open === 'bash'
                ? '命令在电脑后台执行，点一行看全文输出。'
                : open === 'agent'
                  ? '会话派出的子 Agent，点一行看过程与结果。'
                  : '这个会话最新的任务清单。'}
            </p>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
            {open === 'bash' && (
              <BashRows sessionId={sessionId} tasks={tasks} writable={writable} onStopped={close} />
            )}
            {open === 'agent' && (
              <AgentRows
                sessionId={sessionId}
                agents={subagents}
                writable={writable}
                onStopped={close}
              />
            )}
            {open === 'todo' && todos && <TodoRows todos={todos.todos} />}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function DockPill({
  kind,
  icon: Icon,
  label,
  count,
  failed,
  active,
  open,
  onClick,
}: {
  kind: DockKind;
  icon: typeof Bot;
  label: string;
  count: string;
  failed?: number;
  active?: boolean;
  open: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      data-phone-task-dock={kind}
      aria-expanded={open}
      onClick={onClick}
      className={cn(
        'relative flex h-8 min-w-0 items-center gap-1.5 rounded-full bg-card2 px-3 text-[12px] leading-4 transition-colors',
        open && 'bg-card'
      )}
    >
      {active ? (
        <LoaderCircle className="size-3.5 shrink-0 animate-spin text-dim" aria-hidden />
      ) : (
        <Icon className="size-3.5 shrink-0 text-dim" aria-hidden />
      )}
      <span className="shrink-0 text-dim">{label}</span>
      <span className="min-w-0 truncate text-ink2 tabular-nums">{count}</span>
      {failed !== undefined && failed > 0 && (
        <span
          data-phone-task-failed=""
          role="img"
          aria-label="有失败项"
          className="ml-0.5 size-1.5 shrink-0 rounded-full bg-red"
        />
      )}
    </button>
  );
}

function StopButton({ label, onClick }: { label: string; onClick(): void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex size-7 shrink-0 items-center justify-center rounded-full bg-card text-red"
    >
      <Square className="size-3" aria-hidden />
    </button>
  );
}

function StatusIcon({ state }: { state: 'running' | 'failed' | 'done' }) {
  if (state === 'running')
    return <LoaderCircle className="size-3.5 shrink-0 animate-spin text-dim" aria-hidden />;
  if (state === 'failed') return <CircleAlert className="size-3.5 shrink-0 text-red" aria-hidden />;
  return <Check className="size-3.5 shrink-0 text-green" aria-hidden />;
}

function BashRows({
  sessionId,
  tasks,
  writable,
  onStopped,
}: {
  sessionId: string;
  tasks: BackgroundTaskInfo[];
  writable: boolean;
  onStopped(): void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  if (tasks.length === 0)
    return <p className="py-8 text-center text-[12px] leading-4 text-dim">没有后台命令。</p>;
  return (
    <div className="flex flex-col">
      {tasks.map((task, index) => (
        <div key={task.taskId} className={cn('py-2.5', index > 0 && 'border-line/70 border-t')}>
          <div className="flex min-w-0 items-center gap-2">
            <StatusIcon
              state={
                task.status === 'running' ? 'running' : task.status === 'failed' ? 'failed' : 'done'
              }
            />
            <button
              type="button"
              aria-label={`展开 ${task.command}`}
              aria-expanded={expanded === task.taskId}
              onClick={() => setExpanded(expanded === task.taskId ? null : task.taskId)}
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
            >
              <span
                className="min-w-0 flex-1 truncate font-mono text-[12px] leading-4 text-ink2"
                title={task.command}
              >
                $ {task.command}
              </span>
              <span className="shrink-0 text-[11px] leading-4 text-faint tabular-nums">
                {taskStatusText(task)}
              </span>
              <ChevronRight
                className={cn(
                  'size-3.5 shrink-0 text-faint transition-transform',
                  expanded === task.taskId && 'rotate-90'
                )}
                aria-hidden
              />
            </button>
            {task.status === 'running' && writable && (
              <StopButton
                label={`停止 ${task.command}`}
                onClick={() => {
                  void window.electronAPI.agent.stopTask(sessionId, task.taskId);
                  onStopped();
                }}
              />
            )}
          </div>
          {expanded === task.taskId && (
            <pre className="mt-2 max-h-[40vh] overflow-auto rounded-[12px] bg-card2 px-3 py-2 font-mono text-[11px] leading-4 whitespace-pre-wrap text-ink2">
              {stripAnsi(task.tail) || '（还没有输出）'}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}

function AgentRows({
  sessionId,
  agents,
  writable,
  onStopped,
}: {
  sessionId: string;
  agents: SubagentInfo[];
  writable: boolean;
  onStopped(): void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  if (agents.length === 0)
    return <p className="py-8 text-center text-[12px] leading-4 text-dim">没有后台 Agent。</p>;
  return (
    <div className="flex flex-col">
      {agents.map((agent, index) => {
        const lines = agent.activities?.length
          ? agent.activities.map((activity) =>
              activity.type === 'assistant'
                ? activity.text
                : [activity.toolName, activity.argumentsText, activity.outputText]
                    .filter(Boolean)
                    .join('\n')
            )
          : (agent.activityLog ?? []);
        return (
          <div key={agent.id} className={cn('py-2.5', index > 0 && 'border-line/70 border-t')}>
            <div className="flex min-w-0 items-center gap-2">
              <StatusIcon
                state={
                  agent.status === 'running'
                    ? 'running'
                    : agent.status === 'failed'
                      ? 'failed'
                      : 'done'
                }
              />
              <button
                type="button"
                aria-label={`展开 Agent ${agent.description}`}
                aria-expanded={expanded === agent.id}
                onClick={() => setExpanded(expanded === agent.id ? null : agent.id)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <span className="min-w-0 flex-1 truncate text-[13px] leading-[18px]">
                  {agent.agentType && <span className="mr-1.5 font-medium">{agent.agentType}</span>}
                  <span className="text-dim">{agent.description}</span>
                </span>
                <span className="shrink-0 text-[11px] leading-4 text-faint tabular-nums">
                  {agentStatusText(agent)}
                </span>
                <ChevronRight
                  className={cn(
                    'size-3.5 shrink-0 text-faint transition-transform',
                    expanded === agent.id && 'rotate-90'
                  )}
                  aria-hidden
                />
              </button>
              {agent.status === 'running' && writable && (
                <StopButton
                  label={`取消 Agent ${agent.description}`}
                  onClick={() => {
                    void window.electronAPI.agent.stopSubagent(sessionId, agent.id);
                    onStopped();
                  }}
                />
              )}
            </div>
            {expanded === agent.id && (
              <div className="mt-2 flex flex-col gap-2">
                {lines.length > 0 && (
                  <pre className="max-h-[40vh] overflow-auto rounded-[12px] bg-card2 px-3 py-2 font-mono text-[11px] leading-4 whitespace-pre-wrap text-ink2">
                    {stripAnsi(lines.join('\n'))}
                  </pre>
                )}
                {agent.resultText && (
                  <div className="max-h-[40vh] overflow-auto rounded-[12px] bg-card2 px-3 py-2 text-[12px] leading-[18px] text-ink2">
                    <Markdown text={stripAnsi(agent.resultText)} />
                  </div>
                )}
                {!lines.length && !agent.resultText && (
                  <p className="text-[12px] leading-4 text-dim">还没有过程输出。</p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TodoRows({ todos }: { todos: TodoItem[] }) {
  const state = todoDockState({ id: 'current', todos });
  const done = state?.done ?? 0;
  const total = Math.max(1, state?.total ?? 0);
  return (
    <div>
      {state && (
        <div
          className="mb-3 h-1.5 overflow-hidden rounded-full bg-card2"
          role="progressbar"
          aria-label="当前进度"
          aria-valuenow={done}
          aria-valuemax={state.total}
        >
          <div className="h-full bg-pill" style={{ width: `${(done / total) * 100}%` }} />
        </div>
      )}
      <ul className="space-y-2 text-[13px] leading-5">
        {todos.map((todo) => (
          <li key={todo.content} className="flex items-start gap-2.5">
            {todo.status === 'completed' ? (
              <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-green" aria-hidden />
            ) : todo.status === 'in_progress' ? (
              <CircleDot className="mt-0.5 size-3.5 shrink-0 text-ink2" aria-hidden />
            ) : (
              <Circle className="mt-0.5 size-3.5 shrink-0 text-faint" aria-hidden />
            )}
            <span
              className={cn(
                todo.status === 'completed' && 'text-dim line-through decoration-current',
                todo.status === 'in_progress' && 'font-medium',
                todo.status === 'pending' && 'text-dim'
              )}
            >
              {todo.content}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
