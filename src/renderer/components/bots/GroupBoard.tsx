import type {
  BotChat,
  BotProfile,
  Delegation,
  GroupTask,
  GroupTaskStatus,
} from '@shared/types/bot';
import {
  GROUP_TASK_TEXT_MAX,
  GROUP_TASK_TITLE_MAX,
  stalledTaskRun,
  TASK_CHECK_TEXT_MAX,
} from '@shared/types/bot';
import {
  Check,
  ChevronDown,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  Undo2,
  UserPlus,
  Wrench,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ConfirmDialog } from '@/components/chat/ConfirmDialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from '@/components/ui/menu';
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { addToast } from '@/components/ui/toast';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Z_INDEX } from '@/lib/z-index';
import { useBotsStore } from '@/stores/bots';
import { formatElapsed, isRetried } from '@/stores/bots/delegations';
import {
  canRework,
  chatDelegationGroups,
  type TaskBlockInfo,
  taskBlockInfo,
  taskColumns,
} from '@/stores/bots/groupBoard';
import { BotAvatar } from './BotAvatar';
import { FieldLabel } from './BotFields';
import { CheckBadge, DelegationCard, failureText, retryDelegation, useNow } from './DelegationCard';
import { replyToTask, TaskReply, taskErrorText } from './TaskReply';
import { TaskRuns } from './TaskRuns';

/** 已完成 / 已取消 / 终态委派默认只显示最近几条 */
const RECENT = 5;

const TASK_LABELS: Record<GroupTaskStatus, string> = {
  todo: 'To do',
  doing: 'Doing',
  blocked: 'Stuck tasks',
  review: 'Awaiting review',
  done: 'Completed',
  canceled: 'Canceled',
};

const stamp = (at: number) =>
  new Date(at).toLocaleString([], {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

function Group({
  title,
  count,
  limit,
  children,
}: {
  title: string;
  count: number;
  limit?: number;
  children: (shown: number) => React.ReactNode;
}) {
  const { t } = useI18n();
  const [all, setAll] = useState(false);
  const shown = limit && !all ? Math.min(limit, count) : count;
  return (
    <section className="mt-4 first:mt-0">
      <h4 className="mb-1.5 font-medium text-[calc(11rem/14)] text-muted-foreground uppercase tracking-wide">
        {title} · {count}
      </h4>
      <div className="space-y-1.5">{children(shown)}</div>
      {count > shown && (
        <Button size="xs" variant="ghost" className="mt-1" onClick={() => setAll(true)}>
          {t('Show all ({{n}})', { n: count })}
        </Button>
      )}
    </section>
  );
}

/** 群任务看板：按状态分组；新建、编辑、指派（以人类身份 @ 成员）、完成、验收、取消、删除 */
export function TaskBoard({
  chat,
  attentionIds,
  onOpenConversation,
}: {
  chat: BotChat;
  attentionIds: ReadonlySet<string>;
  onOpenConversation: (conversationId: string, title: string) => void;
}) {
  const { t } = useI18n();
  const tasks = useBotsStore((s) => s.tasks[chat.id]);
  const [creating, setCreating] = useState(false);
  const taskFocus = useBotsStore((s) => (s.taskFocus?.chatId === chat.id ? s.taskFocus : null));
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [revealedTaskId, setRevealedTaskId] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const now = useNow(
    Boolean(tasks?.some((task) => task.status === 'blocked' || stalledTaskRun(task)))
  );
  const { card, dialogs } = useTaskManagement(chat, onOpenConversation, now);

  // 从时间线 / 收件箱定位卡片：先解除筛选和历史截断，再滚动高亮。
  useEffect(() => {
    if (!taskFocus || !tasks) return;
    const target = boardRef.current?.querySelector(
      `[data-task-id="${CSS.escape(taskFocus.taskId)}"]`
    );
    if (target) {
      setAttentionOnly(false);
      setRevealedTaskId(taskFocus.taskId);
      setHighlight(taskFocus.taskId);
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      target.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
        behavior: reduceMotion ? 'instant' : 'smooth',
      });
    }
    useBotsStore.getState().clearTaskFocus(taskFocus.nonce);
  }, [taskFocus, tasks]);

  useEffect(() => {
    if (!highlight) return;
    const timer = setTimeout(() => setHighlight(null), 2000);
    return () => clearTimeout(timer);
  }, [highlight]);

  const filtered = attentionOnly && !taskFocus;
  const columns = taskColumns(
    filtered ? (tasks ?? []).filter((task) => attentionIds.has(task.id)) : (tasks ?? [])
  );
  const renderGroup = (status: GroupTaskStatus) => {
    const items = columns[status];
    if (items.length === 0) return null;
    const revealed = items.findIndex((task) => task.id === (taskFocus?.taskId ?? revealedTaskId));
    const limit = status === 'done' ? Math.max(RECENT, revealed + 1) : undefined;
    return (
      <Group key={status} title={t(TASK_LABELS[status])} count={items.length} limit={limit}>
        {(shown) =>
          items.slice(0, shown).map((task) => card(task, { highlighted: highlight === task.id }))
        }
      </Group>
    );
  };
  return (
    <div data-slot="group-task-board" className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-line border-b px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <h2 className="min-w-0 flex-1 truncate font-semibold text-sm">{t('Task board')}</h2>
          <Button size="xs" onClick={() => setCreating(true)}>
            <Plus />
            {t('New task')}
          </Button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {[false, true].map((attention) => (
            <Button
              key={String(attention)}
              size="xs"
              variant={filtered === attention ? 'secondary' : 'ghost'}
              aria-pressed={filtered === attention}
              onClick={() => setAttentionOnly(attention)}
            >
              {t(attention ? 'Needs your attention' : 'All tasks')}
              <span className="text-muted-foreground tabular-nums">
                {attention ? attentionIds.size : (tasks?.length ?? 0)}
              </span>
            </Button>
          ))}
        </div>
      </div>
      <div ref={boardRef} className="min-h-0 flex-1 overflow-auto p-3">
        {!tasks ? (
          <Loader2
            aria-label={t('Loading')}
            className="h-4 w-4 animate-spin text-muted-foreground"
          />
        ) : filtered && attentionIds.size === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-muted-foreground text-sm">
            {t('No tasks need your attention')}
          </p>
        ) : (
          <>
            {tasks.length === 0 && (
              <p className="mb-3 rounded-md border border-dashed p-4 text-muted-foreground text-sm">
                {t('No tasks yet. Members can also add and claim tasks with the board tool.')}
              </p>
            )}
            {(['todo', 'doing', 'blocked', 'review', 'done', 'canceled'] as const).map(renderGroup)}
          </>
        )}
      </div>
      {creating && (
        <TaskEditor
          chatId={chat.id}
          onClose={(saved) => {
            setCreating(false);
            if (saved) void useBotsStore.getState().refreshTasks(chat.id);
          }}
        />
      )}
      {dialogs}
    </div>
  );
}

/** Same task actions and lifecycle in both the group and the independent board. */
function useTaskManagement(
  chat: BotChat,
  onOpenConversation: ((conversationId: string, title: string) => void) | undefined,
  now: number
) {
  const { t } = useI18n();
  const bots = useBotsStore((s) => s.bots);
  const delegations = useBotsStore((s) => s.delegations);
  const [editing, setEditing] = useState<GroupTask | null>(null);
  const [deleting, setDeleting] = useState<GroupTask | null>(null);
  const [returning, setReturning] = useState<{ task: GroupTask; rework: boolean } | null>(null);
  const byId = useMemo(() => new Map(bots.map((bot) => [bot.id, bot])), [bots]);
  const members = (chat.members ?? []).flatMap((id) => {
    const bot = byId.get(id);
    return bot && bot.archivedAt === undefined ? [bot] : [];
  });
  const refresh = () => void useBotsStore.getState().refreshTasks(chat.id);
  const run = async (action: () => Promise<{ ok: boolean; error?: string }>, failed: string) => {
    try {
      const result = await action();
      if (!result.ok)
        addToast({
          type: 'error',
          title: failed,
          description: taskErrorText(result.error ?? '', t),
        });
    } catch {
      addToast({ type: 'error', title: failed });
    }
    refresh();
  };
  const api = window.electronAPI.bots.tasks;
  const ref = (task: GroupTask) => ({ chatId: chat.id, id: task.id });

  const card = (task: GroupTask, options?: { highlighted?: boolean; expanded?: boolean }) => (
    <TaskCard
      key={task.id}
      task={task}
      bots={byId}
      members={members}
      onOpenConversation={onOpenConversation}
      block={taskBlockInfo(task, delegations)}
      now={now}
      {...options}
      onEdit={() => setEditing(task)}
      onAssign={(botId) =>
        void run(() => api.assign({ ...ref(task), botId }), t('Task not assigned'))
      }
      onComplete={() => void run(() => api.complete(ref(task)), t('Task not updated'))}
      onAccept={() =>
        void run(() => api.review({ ...ref(task), accept: true }), t('Task not updated'))
      }
      onReturn={(rework) => setReturning({ task, rework })}
      onCancel={() => void run(() => api.cancel(ref(task)), t('Task not updated'))}
      onDelete={() => setDeleting(task)}
      onReply={(text) => replyToTask(chat.id, task.id, text, t)}
    />
  );
  const dialogs = (
    <>
      {editing && (
        <TaskEditor
          chatId={chat.id}
          task={editing}
          onClose={(saved) => {
            setEditing(null);
            if (saved) refresh();
          }}
        />
      )}
      {returning && (
        <ReturnDialog
          task={returning.task}
          assignee={byId.get(returning.task.assigneeBotId ?? '')?.name ?? t('Deleted member')}
          rework={returning.rework}
          onClose={() => setReturning(null)}
          onReturn={(reason) =>
            api
              .review({
                ...ref(returning.task),
                accept: false,
                reason,
                ...(returning.rework ? { rework: true } : {}),
              })
              .then((result) => {
                if (result.ok) {
                  setReturning(null);
                  refresh();
                }
                return result.ok ? null : taskErrorText(result.error, t);
              })
              .catch(() => t('Task not updated'))
          }
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('Delete task #{{n}}?', { n: deleting?.seq ?? '' })}
        description={t('The task is removed from the board. This cannot be undone.')}
        confirmLabel={t('Delete')}
        onConfirm={() => {
          const task = deleting;
          setDeleting(null);
          if (task) void run(() => api.remove(ref(task)), t('Task not deleted'));
        }}
      />
    </>
  );
  return { card, dialogs };
}

export function ManagedTaskDetail({ chat, task }: { chat: BotChat; task: GroupTask }) {
  const now = useNow(task.status === 'blocked' || Boolean(stalledTaskRun(task)));
  const { card, dialogs } = useTaskManagement(chat, undefined, now);
  return (
    <>
      {card(task, { expanded: true })}
      {dialogs}
    </>
  );
}

function TaskCard({
  task,
  bots,
  members,
  onOpenConversation,
  onEdit,
  onAssign,
  onComplete,
  onAccept,
  onReturn,
  onCancel,
  onDelete,
  onReply,
  block,
  now,
  highlighted,
  expanded,
}: {
  task: GroupTask;
  bots: Map<string, BotProfile>;
  members: BotProfile[];
  onOpenConversation?: (conversationId: string, title: string) => void;
  /** 卡住的原因、等谁、从何时起 */
  block?: TaskBlockInfo;
  now: number;
  /** 刚从时间线 / 收件箱打开 */
  highlighted?: boolean;
  expanded?: boolean;
  onEdit: () => void;
  onAssign: (botId: string) => void;
  onComplete: () => void;
  onAccept: () => void;
  /** rework：原执行人在原会话返工；否则退回待办 */
  onReturn: (rework: boolean) => void;
  onCancel: () => void;
  onDelete: () => void;
  /** 任务卡回复框：缺信息卡住时解除，执行中插入当前执行，其他状态记评论 */
  onReply: (text: string) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const [detailOpen, setDetailOpen] = useState(false);
  const showDetails = expanded || detailOpen;
  const canShowDetails = Boolean(task.detail || task.result || task.returnReason);
  const open = task.status === 'todo' || task.status === 'doing' || task.status === 'blocked';
  const review = task.status === 'review';
  // 执行失败：仍由执行人负责，只能重试、改派或取消
  const stalled = stalledTaskRun(task);
  const canAssign =
    open && (!task.delegationId || task.status === 'blocked' || stalled) && members.length > 0;
  const assignLabel = t(task.assigneeBotId ? 'Reassign to' : 'Assign to');
  const assignItems = () =>
    members.map((bot) => (
      <MenuItem
        key={bot.id}
        disabled={bot.id === task.assigneeBotId}
        onClick={() => onAssign(bot.id)}
      >
        <BotAvatar bot={bot} size="xs" />
        {bot.name}
      </MenuItem>
    ));
  const assignee = task.assigneeBotId ? bots.get(task.assigneeBotId) : undefined;
  const creator =
    task.createdBy === 'human' ? t('You') : (bots.get(task.createdBy)?.name ?? t('Deleted member'));
  return (
    <div
      data-slot="bot-card"
      data-task-id={expanded ? undefined : task.id}
      className={cn(
        'group rounded-md border bg-card px-2.5 py-2 text-[calc(11rem/14)] transition-shadow',
        !expanded && !open && !review && 'opacity-75',
        expanded && 'space-y-2 border-0 bg-transparent p-0 text-xs',
        highlighted && 'ring-2 ring-brand/60'
      )}
    >
      <div className="flex items-start gap-1.5">
        <span className="shrink-0 text-muted-foreground">#{task.seq}</span>
        {canShowDetails && !expanded ? (
          <button
            type="button"
            aria-expanded={showDetails}
            title={t(showDetails ? 'Hide task details' : 'Show task details')}
            className="flex min-w-0 flex-1 items-start gap-1 text-left font-medium text-sm hover:text-brand"
            onClick={() => setDetailOpen((shown) => !shown)}
          >
            <span className="min-w-0 break-words">{task.title}</span>
            <ChevronDown
              aria-hidden
              className={cn(
                'mt-0.5 size-3.5 shrink-0 text-muted-foreground',
                showDetails && 'rotate-180'
              )}
            />
          </button>
        ) : (
          <span className="min-w-0 flex-1 break-words font-medium text-sm">{task.title}</span>
        )}
        <Menu>
          <MenuTrigger
            aria-label={t('Task actions')}
            className={cn(
              'shrink-0 rounded p-1 text-muted-foreground hover:bg-muted',
              !expanded &&
                'opacity-0 focus-visible:opacity-100 group-hover:opacity-100 data-popup-open:opacity-100 pointer-coarse:opacity-100'
            )}
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuItem onClick={onEdit}>
              <Pencil />
              {t('Edit')}
            </MenuItem>
            {!expanded && canAssign && (
              <MenuSub>
                <MenuSubTrigger>
                  <UserPlus />
                  {assignLabel}
                </MenuSubTrigger>
                <MenuSubPopup>{assignItems()}</MenuSubPopup>
              </MenuSub>
            )}
            {open && !stalled && (
              <MenuItem onClick={onComplete}>
                <Check />
                {t('Mark done')}
              </MenuItem>
            )}
            {(open || review) && (
              <MenuItem onClick={onCancel}>
                <X />
                {t('Cancel task')}
              </MenuItem>
            )}
            <MenuSeparator />
            <MenuItem variant="destructive" onClick={onDelete}>
              <Trash2 />
              {t('Delete')}
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>
      {expanded && canAssign && block?.reason !== 'failed' && (
        <Menu>
          <MenuTrigger render={<Button size="xs" variant="outline" />}>
            <UserPlus />
            {assignLabel}
          </MenuTrigger>
          <MenuPopup align="start">{assignItems()}</MenuPopup>
        </Menu>
      )}
      {task.detail && (
        <div
          className={cn(
            'mt-1 whitespace-pre-wrap break-words text-muted-foreground',
            !showDetails && 'line-clamp-3'
          )}
        >
          {task.detail}
        </div>
      )}
      {task.result && (
        <div
          className={cn(
            'mt-1 rounded px-1.5 py-1 text-foreground',
            task.status !== 'done' && task.check?.passed === false
              ? 'bg-destructive/10'
              : 'bg-success/10'
          )}
        >
          <div className={cn('whitespace-pre-wrap break-words', !showDetails && 'line-clamp-3')}>
            {task.result}
          </div>
        </div>
      )}
      {task.returnReason && (
        <div className="mt-1 rounded bg-warning/10 px-1.5 py-1 text-foreground">
          <div className={cn('whitespace-pre-wrap break-words', !showDetails && 'line-clamp-3')}>
            {t('Returned: {{reason}}', { reason: task.returnReason })}
          </div>
        </div>
      )}
      {block && (
        <BlockedPanel
          block={block}
          now={now}
          assignee={assignee}
          bots={bots}
          members={members}
          assigneeBotId={task.assigneeBotId}
          onRetry={() => stalled && retryDelegation(stalled.id, t)}
          onAssign={onAssign}
          onCancel={onCancel}
          onReply={onReply}
        />
      )}
      {!block && (review || (task.status === 'doing' && task.delegationId)) && (
        <TaskReply
          placeholder={review ? t('Comment…') : t('Add to the current run…')}
          onSend={onReply}
        />
      )}
      {task.check && <CheckBadge check={task.check} className="mt-1" />}
      {review && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <Button size="xs" onClick={onAccept}>
            <Check />
            {t('Accept result')}
          </Button>
          <Button size="xs" variant="outline" onClick={() => onReturn(false)}>
            <Undo2 />
            {t('Return')}
          </Button>
          {canRework(task) && (
            <Button size="xs" variant="outline" onClick={() => onReturn(true)}>
              <Wrench />
              {t('Return for rework')}
            </Button>
          )}
        </div>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-muted-foreground">
        {assignee || task.assigneeBotId ? (
          <span className="flex items-center gap-1">
            <BotAvatar bot={assignee} size="xs" />
            {assignee?.name ?? t('Deleted member')}
          </span>
        ) : (
          <span>{t('Unassigned')}</span>
        )}
        {task.delegationId && <span>· {t('Delegation')}</span>}
        <span className="flex-1" />
        <span title={t('Created by {{name}}', { name: creator })}>{stamp(task.updatedAt)}</span>
      </div>
      {task.runs && task.runs.length > 0 && (
        <TaskRuns runs={task.runs} bots={bots} onOpenConversation={onOpenConversation} />
      )}
    </div>
  );
}

/** 卡住：缺信息给回复框；执行失败只给重试 / 改派 / 取消 */
function BlockedPanel({
  block,
  now,
  assignee,
  assigneeBotId,
  bots,
  members,
  onRetry,
  onAssign,
  onCancel,
  onReply,
}: {
  block: TaskBlockInfo;
  now: number;
  assignee?: BotProfile;
  assigneeBotId?: string;
  bots: Map<string, BotProfile>;
  members: BotProfile[];
  onRetry: () => void;
  onAssign: (botId: string) => void;
  onCancel: () => void;
  onReply: (text: string) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const name = assignee?.name ?? t('Deleted member');
  const elapsed = t('Stuck for {{time}}', { time: formatElapsed(now - block.since) });
  if (block.reason === 'need') {
    const waiting =
      block.waitFor === 'human'
        ? t('Waiting for your reply')
        : t('Waiting for {{name}} to reply', {
            name: bots.get(block.waitFor)?.name ?? t('Deleted member'),
          });
    return (
      <div className="mt-1.5 rounded-md border border-warning/30 bg-warning/10 px-2 py-1.5 text-foreground">
        <div className="line-clamp-4 whitespace-pre-wrap font-medium">
          {t('Blocked · needs: {{need}}', { need: block.need })}
        </div>
        <div className="mt-0.5 text-muted-foreground">
          {waiting} · {elapsed}
        </div>
        {block.humanOnly && (
          <div className="mt-0.5 text-muted-foreground">
            {t('Stuck several times in a row; only you can answer now.')}
          </div>
        )}
        <TaskReply
          placeholder={t('Answer {{name}}; they continue after your reply…', { name })}
          onSend={onReply}
        />
      </div>
    );
  }
  const reason = (block.record?.state === 'failed' && failureText(block.record, t)) || t('Failed');
  return (
    <div className="mt-1.5 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-foreground">
      <div className="line-clamp-4 whitespace-pre-wrap font-medium">
        {t('Blocked · run failed: {{reason}}', { reason })}
      </div>
      <div className="mt-0.5 text-muted-foreground">
        {t('Waiting for you to handle it')} · {elapsed}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <Button size="xs" variant="outline" onClick={onRetry}>
          <RotateCcw />
          {t('Retry')}
        </Button>
        {members.length > 0 && (
          <Menu>
            <MenuTrigger render={<Button size="xs" variant="outline" />}>
              <UserPlus />
              {t('Reassign')}
            </MenuTrigger>
            <MenuPopup align="start">
              {members.map((bot) => (
                <MenuItem
                  key={bot.id}
                  disabled={bot.id === assigneeBotId}
                  onClick={() => onAssign(bot.id)}
                >
                  <BotAvatar bot={bot} size="xs" />
                  {bot.name}
                </MenuItem>
              ))}
            </MenuPopup>
          </Menu>
        )}
        <Button size="xs" variant="outline" onClick={onCancel}>
          <X />
          {t('Cancel task')}
        </Button>
      </div>
    </div>
  );
}

/** 验收退回：必须写原因；rework 时原执行人带着原因在原会话返工 */
function ReturnDialog({
  task,
  assignee,
  rework,
  onClose,
  onReturn,
}: {
  task: GroupTask;
  assignee: string;
  rework: boolean;
  onClose: () => void;
  /** 返回错误文案，成功返回 null */
  onReturn: (reason: string) => Promise<string | null>;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!reason.trim()) return setError(t('Enter a reason.'));
    setBusy(true);
    try {
      setError(await onReturn(reason.trim()));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {rework
              ? t('Return task #{{n}} for rework', { n: task.seq })
              : t('Return task #{{n}}', { n: task.seq })}
          </DialogTitle>
        </DialogHeader>
        <DialogPanel className="space-y-2">
          <FieldLabel>{t('Reason for returning')}</FieldLabel>
          <Textarea
            rows={4}
            autoFocus
            value={reason}
            maxLength={GROUP_TASK_TEXT_MAX}
            onChange={(event) => setReason(event.target.value)}
          />
          <p className="text-muted-foreground text-[calc(11rem/14)]">
            {rework
              ? t(
                  '{{name}} continues in the same conversation with this reason, and the result comes back for review.',
                  { name: assignee }
                )
              : t('The task goes back to To do with this reason and can be reassigned.')}
          </p>
          {error && <p className="text-destructive text-sm">{error}</p>}
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button size="sm" disabled={busy} onClick={() => void submit()}>
            {busy && <Loader2 className="animate-spin" />}
            {rework ? t('Return for rework') : t('Return')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TaskEditor({
  chatId,
  groups,
  task,
  onClose,
}: {
  chatId?: string;
  groups?: readonly BotChat[];
  task?: GroupTask;
  onClose: (saved: boolean, savedChatId?: string) => void;
}) {
  const { t } = useI18n();
  const [selectedChatId, setSelectedChatId] = useState(
    chatId ?? (groups?.length === 1 ? groups[0].id : '')
  );
  const [title, setTitle] = useState(task?.title ?? '');
  const [detail, setDetail] = useState(task?.detail ?? '');
  const [check, setCheck] = useState(task?.check?.text ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const groupItems = groups?.map((group) => ({ value: group.id, label: group.title }));
  const save = async () => {
    if (busy) return;
    if (!selectedChatId || (groups && !groups.some((group) => group.id === selectedChatId)))
      return setError(t('Choose a group for this task.'));
    if (!title.trim()) return setError(t('Enter a title.'));
    setBusy(true);
    try {
      const result = await window.electronAPI.bots.tasks.save({
        chatId: selectedChatId,
        title: title.trim(),
        detail: detail.trim(),
        check: check.trim(),
        ...(task ? { id: task.id } : {}),
      });
      if (result.ok) onClose(true, selectedChatId);
      else setError(taskErrorText(result.error, t));
    } catch {
      setError(t('Task not updated'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose(false)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{task ? t('Edit task #{{n}}', { n: task.seq }) : t('New task')}</DialogTitle>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          {groups && !task && (
            <div className="space-y-1">
              <Label>{t('Task group')}</Label>
              <Select
                items={groupItems}
                value={selectedChatId}
                onValueChange={(id) => setSelectedChatId(id ?? '')}
                disabled={busy}
              >
                <SelectTrigger aria-label={t('Task group')}>
                  <SelectValue placeholder={t('Choose a group')} />
                </SelectTrigger>
                <SelectPopup zIndex={Z_INDEX.DROPDOWN_IN_MODAL} alignItemWithTrigger={false}>
                  {groupItems?.map((group) => (
                    <SelectItem key={group.value} value={group.value}>
                      {group.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
          )}
          <div>
            <FieldLabel>{t('Task title')}</FieldLabel>
            <Input
              aria-label={t('Task title')}
              value={title}
              disabled={busy}
              maxLength={GROUP_TASK_TITLE_MAX}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div>
            <FieldLabel>{t('Details')}</FieldLabel>
            <Textarea
              aria-label={t('Details')}
              rows={4}
              value={detail}
              disabled={busy}
              maxLength={GROUP_TASK_TEXT_MAX}
              onChange={(event) => setDetail(event.target.value)}
            />
          </div>
          <div>
            <FieldLabel>{t('Acceptance check (optional)')}</FieldLabel>
            <Input
              aria-label={t('Acceptance check (optional)')}
              value={check}
              disabled={busy}
              maxLength={TASK_CHECK_TEXT_MAX}
              onChange={(event) => setCheck(event.target.value)}
            />
            <p className="mt-1 text-muted-foreground text-[calc(11rem/14)]">
              {t(
                "Done only when the member's tool output contains this text, e.g. a command printing ALL_TESTS_PASS."
              )}
            </p>
          </div>
          {error && <p className="text-destructive text-sm">{error}</p>}
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => onClose(false)}>
            {t('Cancel')}
          </Button>
          <Button size="sm" disabled={busy} onClick={() => void save()}>
            {busy && <Loader2 className="animate-spin" />}
            {t('Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 本群委派汇总：进行中 / 已完成 / 失败·中断·取消；复用委派卡片的取消、重试、查看过程 */
export function GroupDelegations({
  chat,
  onOpenConversation,
}: {
  chat: BotChat;
  onOpenConversation: (conversationId: string, title: string) => void;
}) {
  const { t } = useI18n();
  const delegations = useBotsStore((s) => s.delegations);
  const bots = useBotsStore((s) => s.bots);
  const byId = useMemo(() => new Map(bots.map((bot) => [bot.id, bot])), [bots]);
  const groups = useMemo(() => chatDelegationGroups(delegations, chat.id), [delegations, chat.id]);
  const card = (record: Delegation) => (
    <DelegationCard
      key={record.id}
      record={record}
      retried={isRetried(record, delegations)}
      bots={byId}
      onOpenConversation={onOpenConversation}
    />
  );
  if (!groups.active.length && !groups.completed.length && !groups.failed.length)
    return (
      <p className="text-muted-foreground text-[calc(11rem/14)]">
        {t('No delegations in this group yet')}
      </p>
    );
  return (
    <div>
      {groups.active.length > 0 && (
        <Group title={t('In progress')} count={groups.active.length}>
          {() => groups.active.map(card)}
        </Group>
      )}
      {groups.completed.length > 0 && (
        <Group title={t('Completed')} count={groups.completed.length} limit={RECENT}>
          {(shown) => groups.completed.slice(0, shown).map(card)}
        </Group>
      )}
      {groups.failed.length > 0 && (
        <Group
          title={t('Failed · interrupted · canceled')}
          count={groups.failed.length}
          limit={RECENT}
        >
          {(shown) => groups.failed.slice(0, shown).map(card)}
        </Group>
      )}
    </div>
  );
}
