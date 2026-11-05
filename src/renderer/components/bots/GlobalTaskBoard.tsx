import {
  ArrowLeft,
  ArrowUpRight,
  Circle,
  CircleAlert,
  CircleCheck,
  CircleDot,
  ClipboardCheck,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { useBotsStore } from '@/stores/bots';
import { taskBlockInfo } from '@/stores/bots/groupBoard';
import { BotAvatar } from './BotAvatar';
import { ManagedTaskDetail, TaskEditor } from './GroupBoard';
import { filterBoard, type GlobalTaskRow, globalBoard, rootBoardGroups } from './globalBoard';

interface GlobalTaskBoardProps {
  enabled: boolean;
  onBack: () => void;
  onOpenTask: (chatId: string, taskId: string) => void;
  onOpenGroup: (chatId: string) => void;
}

const COLUMNS = [
  ['todo', 'To do', Circle, 'text-muted-foreground'],
  ['doing', 'Doing', CircleDot, 'text-info'],
  ['blocked', 'Stuck tasks', CircleAlert, 'text-warning'],
  ['review', 'Awaiting review', ClipboardCheck, 'text-brand'],
  ['done', 'Completed', CircleCheck, 'text-success'],
] as const;

function useBoardLoad(rootIds: string[]) {
  const [revision, setRevision] = useState(0);
  const [catalog, setCatalog] = useState<{ revision: number; failed: boolean }>();
  const [load, setLoad] = useState<{ revision: number; ids: string[]; failed: string[] }>();
  const catalogReady = catalog?.revision === revision;

  useEffect(() => {
    let canceled = false;
    const { refreshCatalog, refreshChats, refreshDelegations } = useBotsStore.getState();
    // Coalesced store refreshes swallow failures. Probe chat discovery explicitly, but leave
    // applying its snapshot to refreshChats so pending thread choices are never overwritten.
    void Promise.allSettled([
      refreshCatalog(),
      refreshChats(),
      refreshDelegations(),
      window.electronAPI.bots.chats().then((result) => result.ok),
    ]).then((results) => {
      if (!canceled)
        setCatalog({
          revision,
          failed: results.some((result) => result.status === 'rejected' || result.value === false),
        });
    });
    return () => {
      canceled = true;
    };
  }, [revision]);

  useEffect(() => {
    if (!catalogReady) return;
    let canceled = false;
    const previous = useBotsStore.getState().tasks;
    void Promise.allSettled(
      rootIds.map(async (id) => {
        const result = await window.electronAPI.bots.tasks.list(id);
        if (!result.ok) return false;
        if (!canceled) {
          useBotsStore.setState((state) => {
            // Don't overwrite a fresher event-driven refresh while our request was in flight.
            if (state.tasks[id] !== previous[id]) return state;
            return { tasks: { ...state.tasks, [id]: result.tasks } };
          });
        }
        return true;
      })
    ).then((results) => {
      if (canceled) return;
      const failed = rootIds.filter((_, index) => {
        const result = results[index];
        return result.status === 'rejected' || !result.value;
      });
      setLoad({ revision, ids: rootIds, failed });
    });
    return () => {
      canceled = true;
    };
  }, [catalogReady, revision, rootIds]);

  return {
    loading: !catalogReady || load?.revision !== revision || load.ids !== rootIds,
    catalogFailed: catalog?.failed ?? false,
    failedIds: load?.failed ?? [],
    refresh: () => setRevision((current) => current + 1),
  };
}

function ActiveBoard({ onBack, onOpenTask, onOpenGroup }: Omit<GlobalTaskBoardProps, 'enabled'>) {
  const { t } = useI18n();
  const chats = useBotsStore((state) => state.chats);
  const bots = useBotsStore((state) => state.bots);
  const tasks = useBotsStore((state) => state.tasks);
  const delegations = useBotsStore((state) => state.delegations);
  // Depend on membership, not task/cache or title changes, when preloading group tasks.
  const rootIds = useBotsStore(
    useShallow((state) =>
      rootBoardGroups(state.chats)
        .map((group) => group.id)
        .sort()
    )
  );
  const groups = useMemo(() => rootBoardGroups(chats), [chats]);
  const byId = useMemo(() => new Map(bots.map((bot) => [bot.id, bot])), [bots]);
  const [groupId, setGroupId] = useState('');
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [query, setQuery] = useState('');
  const [assignee, setAssignee] = useState('');
  const [creating, setCreating] = useState(false);
  const [selection, setSelection] = useState<{ groupId: string; taskId: string } | null>(null);
  const group = groups.find((item) => item.id === groupId);
  const board = useMemo(
    () => globalBoard(groups, tasks, delegations),
    [groups, tasks, delegations]
  );
  const scoped = useMemo(
    () =>
      filterBoard(board, {
        groupId: group?.id,
        assignee: assignee === 'unassigned' ? null : assignee ? assignee.slice(7) : undefined,
        query,
      }),
    [board, group?.id, assignee, query]
  );
  const visible = useMemo(
    () => (attentionOnly ? filterBoard(scoped, { attentionOnly: true }) : scoped),
    [scoped, attentionOnly]
  );
  const { columns, total } = visible;
  const selectedGroup = selection
    ? groups.find((item) => item.id === selection.groupId)
    : undefined;
  const selectedTask =
    selectedGroup && tasks[selectedGroup.id]?.find((task) => task.id === selection?.taskId);
  const selectedStatus =
    selectedTask && (taskBlockInfo(selectedTask, delegations) ? 'blocked' : selectedTask.status);
  const selectedLabel = COLUMNS.find(([status]) => status === selectedStatus)?.[1] ?? 'Canceled';
  const { loading, catalogFailed, failedIds, refresh } = useBoardLoad(rootIds);
  const failedGroups = groups.filter((item) => failedIds.includes(item.id));
  const hasErrors = catalogFailed || failedGroups.length > 0;
  const filtered = Boolean(query.trim() || assignee || group || attentionOnly);
  const clearFilters = () => {
    setQuery('');
    setAssignee('');
    setGroupId('');
    setAttentionOnly(false);
  };

  const card = ({ group, task, needsAttention }: GlobalTaskRow) => {
    const member = task.assigneeBotId ? byId.get(task.assigneeBotId) : undefined;
    const assigneeName = task.assigneeBotId
      ? (member?.name ?? t('Unknown member'))
      : t('Unassigned');
    const block = taskBlockInfo(task, delegations);
    const excerpt =
      block?.reason === 'need' ? block.need : task.returnReason || task.result || task.detail;
    const selected = selectedGroup?.id === group.id && selectedTask?.id === task.id;
    const updated = new Date(task.updatedAt);
    return (
      <Button
        key={JSON.stringify([group.id, task.id])}
        variant="ghost"
        data-slot="bot-card-button"
        data-task-id={task.id}
        data-group-id={group.id}
        aria-pressed={selected}
        className={cn(
          'h-auto w-full min-w-0 flex-col items-stretch gap-2 whitespace-normal rounded-lg border border-line bg-card p-3 text-left shadow-xs hover:border-brand/40 hover:bg-card',
          selected && 'border-brand/60 ring-1 ring-brand/30'
        )}
        onClick={() => setSelection({ groupId: group.id, taskId: task.id })}
      >
        <span className="flex items-center gap-2 text-muted-foreground text-xs">
          <span className="tabular-nums">#{task.seq}</span>
          <span className="min-w-0 flex-1 truncate" title={group.title}>
            {group.title}
          </span>
          {needsAttention && (
            <span
              className="size-1.5 shrink-0 rounded-full bg-warning"
              title={t('Needs your attention')}
            />
          )}
        </span>
        <span
          className="wrap-anywhere line-clamp-3 font-medium text-sm leading-relaxed"
          title={task.title}
        >
          {task.title}
        </span>
        {excerpt && (
          <span
            className={cn(
              'line-clamp-2 wrap-anywhere text-xs leading-relaxed',
              block ? 'text-warning' : 'text-muted-foreground'
            )}
          >
            {excerpt}
          </span>
        )}
        {block?.reason === 'failed' && (
          <span className="text-warning text-xs">{t('Execution failed')}</span>
        )}
        <span
          className="mt-1 flex items-center gap-1.5 text-muted-foreground text-xs"
          title={assigneeName}
        >
          <BotAvatar bot={member} size="xs" />
          <span className="min-w-0 flex-1 truncate">{assigneeName}</span>
          {Number.isFinite(updated.getTime()) && (
            <time
              className="shrink-0 text-[calc(10rem/14)] tabular-nums"
              dateTime={updated.toISOString()}
              title={updated.toLocaleString()}
            >
              {updated.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </time>
          )}
        </span>
      </Button>
    );
  };

  const items = [
    { value: '', label: t('All group chats') },
    ...groups.map((item) => ({ value: item.id, label: item.title })),
  ];
  const assigneeIds = new Set(
    Object.values(board.columns)
      .flat()
      .flatMap(({ task }) => (task.assigneeBotId ? [task.assigneeBotId] : []))
  );
  if (assignee.startsWith('member:')) assigneeIds.add(assignee.slice('member:'.length));
  const assigneeItems = [
    { value: '', label: t('All assignees') },
    { value: 'unassigned', label: t('Unassigned') },
    ...[...assigneeIds].map((id) => ({
      value: `member:${id}`,
      label: byId.get(id)?.name ?? t('Unknown member'),
    })),
  ];
  return (
    <>
      <header className="flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-semibold text-[calc(26rem/14)] tracking-tight">
            {t('Collaboration board')}
          </h1>
          <p className="mt-1 text-muted-foreground text-sm">
            {t('Create, assign and review tasks across your group chats.')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft />
            {t('Back to workspace')}
          </Button>
          <Button size="sm" disabled={!groups.length} onClick={() => setCreating(true)}>
            <Plus />
            {t('New task')}
          </Button>
        </div>
      </header>
      <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <span className="text-muted-foreground">
          {t('{{n}} tasks · {{groups}} groups', { n: board.total, groups: groups.length })}
        </span>
        <span className="flex items-center gap-1.5">
          <CircleDot className="size-3.5 text-info" />
          {t('Doing')}{' '}
          <span className="font-medium tabular-nums">{board.columns.doing.length}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <CircleAlert className="size-3.5 text-warning" />
          {t('Stuck tasks')}{' '}
          <span className="font-medium tabular-nums">{board.columns.blocked.length}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <ClipboardCheck className="size-3.5 text-brand" />
          {t('Awaiting review')}{' '}
          <span className="font-medium tabular-nums">{board.columns.review.length}</span>
        </span>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <div className="relative min-w-48 max-w-sm flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 z-10 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label={t('Search tasks')}
            placeholder={t('Search title, details or #number…')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="[&_input]:pl-8"
          />
        </div>
        <Select items={items} value={group?.id ?? ''} onValueChange={(id) => setGroupId(id ?? '')}>
          <SelectTrigger size="sm" className="w-40 max-w-full" aria-label={t('Filter by group')}>
            <SelectValue />
          </SelectTrigger>
          <SelectPopup alignItemWithTrigger={false} className="max-w-xs">
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                <span className="block truncate" title={item.label}>
                  {item.label}
                </span>
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <Select
          items={assigneeItems}
          value={assignee}
          onValueChange={(id) => setAssignee(id ?? '')}
        >
          <SelectTrigger size="sm" className="w-36 max-w-full" aria-label={t('Filter by assignee')}>
            <SelectValue />
          </SelectTrigger>
          <SelectPopup alignItemWithTrigger={false}>
            {assigneeItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        {group && (
          <Button variant="outline" size="sm" onClick={() => onOpenGroup(group.id)}>
            <ArrowUpRight />
            {t('Open group board')}
          </Button>
        )}
        <div className="flex flex-wrap gap-1">
          {[false, true].map((attentionMode) => (
            <Button
              key={String(attentionMode)}
              variant={attentionOnly === attentionMode ? 'secondary' : 'ghost'}
              size="sm"
              aria-pressed={attentionOnly === attentionMode}
              onClick={() => setAttentionOnly(attentionMode)}
            >
              {t(attentionMode ? 'Needs your attention' : 'All tasks')}
              <span className="text-muted-foreground tabular-nums">
                {attentionMode ? scoped.attention : scoped.total}
              </span>
            </Button>
          ))}
        </div>
        <Button variant="ghost" size="sm" className="ml-auto" disabled={loading} onClick={refresh}>
          <RefreshCw />
          {t('Refresh')}
        </Button>
      </div>
      {loading ? (
        <p role="status" className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="size-4 motion-safe:animate-spin" />
          {t('Loading…')}
        </p>
      ) : hasErrors ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-warning/40 px-3 py-2">
          <div role="alert" className="min-w-0 flex-1 wrap-anywhere text-sm">
            {catalogFailed && <p>{t('Could not refresh collaboration board data.')}</p>}
            {failedGroups.length > 0 && (
              <p>
                {t('Could not load tasks for: {{groups}}', {
                  groups: failedGroups.map((item) => item.title).join(', '),
                })}
              </p>
            )}
            {total > 0 && <p className="text-muted-foreground">{t('Showing available tasks.')}</p>}
          </div>
          <Button variant="outline" size="sm" onClick={refresh}>
            {t('Retry')}
          </Button>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 gap-4">
        {groups.length > 0 ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {total === 0 && !loading && !hasErrors && (
              <div className="mb-3 flex shrink-0 items-center justify-between gap-3 rounded-md bg-muted/40 px-4 py-3 text-muted-foreground text-sm">
                <span>
                  {t(filtered ? 'No tasks match these filters.' : 'No tasks on this board yet.')}
                </span>
                {filtered && (
                  <Button size="xs" variant="ghost" onClick={clearFilters}>
                    {t('Clear filters')}
                  </Button>
                )}
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-x-auto pb-2">
              <div
                data-slot="global-collaboration-board-columns"
                className="grid h-full min-h-48 grid-cols-[repeat(5,minmax(10rem,1fr))] gap-3"
              >
                {COLUMNS.map(([status, title, Icon, colour]) => {
                  const rows = columns[status];
                  return (
                    <section
                      key={status}
                      className="flex min-h-0 min-w-0 flex-col rounded-lg bg-muted/30"
                    >
                      <h2 className="flex min-h-11 shrink-0 items-center gap-2 px-3 py-2 font-medium text-sm">
                        <Icon className={cn('size-3.5 shrink-0', colour)} />
                        <span>{t(title)}</span>
                        <span className="ml-auto text-muted-foreground tabular-nums">
                          {rows.length}
                        </span>
                      </h2>
                      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pt-1 pb-2">
                        {rows.map(card)}
                        {rows.length === 0 && (
                          <p className="px-2 py-6 text-center text-muted-foreground/70 text-xs">
                            {t('No tasks in this column')}
                          </p>
                        )}
                        {status === 'todo' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="w-full justify-start text-muted-foreground"
                            aria-label={t('Add a task')}
                            onClick={() => setCreating(true)}
                          >
                            <Plus />
                            {t('Add a task')}
                          </Button>
                        )}
                      </div>
                    </section>
                  );
                })}
              </div>
            </div>
          </div>
        ) : !loading && !hasErrors ? (
          <div className="flex-1 rounded-lg border border-dashed px-6 py-16 text-center">
            <p className="font-medium text-sm">{t('No group chats yet')}</p>
            <p className="mt-2 text-muted-foreground text-sm">
              {t('Create a group chat in the workspace to start collaborating.')}
            </p>
            <Button variant="outline" size="sm" className="mt-4" onClick={onBack}>
              {t('Back to workspace')}
            </Button>
          </div>
        ) : null}
        {selectedTask && selectedGroup && (
          <aside
            aria-label={t('Task details')}
            className="flex min-h-0 w-96 shrink-0 flex-col rounded-lg border border-line bg-card"
          >
            <div className="flex shrink-0 items-center gap-2 border-line border-b p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-sm">{selectedGroup.title}</p>
                <p className="mt-0.5 text-muted-foreground text-xs">{t(selectedLabel)}</p>
              </div>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => onOpenTask(selectedGroup.id, selectedTask.id)}
              >
                <ArrowUpRight />
                {t('Open in group')}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={t('Close task details')}
                onClick={() => setSelection(null)}
              >
                <X />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <ManagedTaskDetail
                key={`${selectedGroup.id}:${selectedTask.id}`}
                chat={selectedGroup}
                task={selectedTask}
              />
            </div>
          </aside>
        )}
      </div>
      {creating && (
        <TaskEditor
          groups={groups}
          chatId={group?.id}
          onClose={(saved, chatId) => {
            setCreating(false);
            if (saved && chatId) {
              setGroupId(chatId);
              setQuery('');
              setAssignee('');
              setAttentionOnly(false);
              void useBotsStore.getState().refreshTasks(chatId);
            }
          }}
        />
      )}
    </>
  );
}

export function GlobalTaskBoard({
  enabled,
  onBack,
  onOpenTask,
  onOpenGroup,
}: GlobalTaskBoardProps) {
  const { t } = useI18n();
  return (
    <main
      data-slot="global-collaboration-board"
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-panel"
    >
      <div className="flex min-h-0 w-full flex-1 flex-col gap-4 p-5 sm:px-7">
        {enabled ? (
          <ActiveBoard onBack={onBack} onOpenTask={onOpenTask} onOpenGroup={onOpenGroup} />
        ) : (
          <div className="space-y-3 rounded-md border border-dashed px-3 py-8 text-center">
            <p className="text-muted-foreground text-sm">
              {t('Enable Bots in settings to view the collaboration board.')}
            </p>
            <Button variant="outline" onClick={() => void window.electronAPI.window.openSettings()}>
              {t('Open settings')}
            </Button>
          </div>
        )}
      </div>
    </main>
  );
}
