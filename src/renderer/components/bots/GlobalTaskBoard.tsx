import { ArrowLeft, ArrowUpRight, Loader2, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useI18n } from '@/i18n';
import { useBotsStore } from '@/stores/bots';
import { type GlobalTaskRow, globalBoard, rootBoardGroups } from './globalBoard';

interface GlobalTaskBoardProps {
  enabled: boolean;
  onBack: () => void;
  onOpenTask: (chatId: string, taskId: string) => void;
  onOpenGroup: (chatId: string) => void;
}

const COLUMNS = [
  ['todo', 'To do'],
  ['doing', 'Doing'],
  ['review', 'Awaiting review'],
  ['done', 'Completed'],
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

function ActiveBoard({
  onOpenTask,
  onOpenGroup,
}: Pick<GlobalTaskBoardProps, 'onOpenTask' | 'onOpenGroup'>) {
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
  const names = useMemo(() => new Map(bots.map((bot) => [bot.id, bot.name])), [bots]);
  const [groupId, setGroupId] = useState('');
  const [attentionOnly, setAttentionOnly] = useState(false);
  const group = groups.find((item) => item.id === groupId);
  const { columns, total, attention } = useMemo(
    () => globalBoard(group ? [group] : groups, tasks, delegations),
    [group, groups, tasks, delegations]
  );
  const { loading, catalogFailed, failedIds, refresh } = useBoardLoad(rootIds);
  const failedGroups = groups.filter((item) => failedIds.includes(item.id));
  const hasErrors = catalogFailed || failedGroups.length > 0;
  const count = attentionOnly ? attention : total;
  const shown = (items: GlobalTaskRow[]) =>
    attentionOnly ? items.filter((item) => item.needsAttention) : items;

  const card = ({ group, task }: GlobalTaskRow) => {
    const assignee = task.assigneeBotId
      ? (names.get(task.assigneeBotId) ?? t('Unknown member'))
      : t('Unassigned');
    return (
      <Button
        key={JSON.stringify([group.id, task.id])}
        variant="ghost"
        data-slot="bot-card-button"
        data-task-id={task.id}
        data-group-id={group.id}
        className="h-auto w-full min-w-0 flex-col items-stretch gap-1 whitespace-normal rounded-md border-line bg-card px-2.5 py-2 text-left hover:bg-accent/50"
        onClick={() => onOpenTask(group.id, task.id)}
      >
        <span className="wrap-anywhere text-sm" title={task.title}>
          {task.title}
        </span>
        <span className="truncate text-muted-foreground text-xs" title={group.title}>
          {group.title}
        </span>
        <span className="truncate text-muted-foreground text-xs" title={assignee}>
          {assignee}
        </span>
      </Button>
    );
  };

  const items = [
    { value: '', label: t('All group chats') },
    ...groups.map((item) => ({ value: item.id, label: item.title })),
  ];
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Select items={items} value={group?.id ?? ''} onValueChange={(id) => setGroupId(id ?? '')}>
          <SelectTrigger size="sm" className="w-48 max-w-full" aria-label={t('Filter by group')}>
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
                {attentionMode ? attention : total}
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
      {count > 0 ? (
        <div className="overflow-x-auto pb-2">
          <div
            data-slot="global-collaboration-board-columns"
            className="grid grid-cols-[repeat(4,minmax(12rem,1fr))] gap-3"
          >
            {COLUMNS.map(([status, title]) => {
              const rows = shown(columns[status]);
              const blocked = status === 'doing' ? shown(columns.blocked) : [];
              return (
                <section
                  key={status}
                  className="min-w-0 space-y-2 rounded-lg border border-line p-2.5"
                >
                  <h2 className="flex items-center justify-between gap-2 px-0.5 font-medium text-sm">
                    {t(title)}
                    <span className="text-muted-foreground tabular-nums">
                      {rows.length + blocked.length}
                    </span>
                  </h2>
                  {rows.map(card)}
                  {blocked.length > 0 && (
                    <section className="space-y-2">
                      <h3 className="px-0.5 font-medium text-warning text-xs">
                        {t('Stuck tasks')} · {blocked.length}
                      </h3>
                      {blocked.map(card)}
                    </section>
                  )}
                </section>
              );
            })}
          </div>
        </div>
      ) : !loading && !hasErrors ? (
        <p className="rounded-md border border-dashed px-3 py-8 text-center text-muted-foreground text-sm">
          {t(
            !groups.length
              ? 'No group chats yet'
              : attentionOnly
                ? 'No tasks need your attention'
                : 'No tasks on this board yet.'
          )}
        </p>
      ) : null}
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
      className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-panel"
    >
      <div className="mx-auto w-full max-w-7xl space-y-4 px-5 py-7 sm:px-9">
        <header>
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 mb-2 text-muted-foreground"
            onClick={onBack}
          >
            <ArrowLeft />
            {t('Back to workspace')}
          </Button>
          <h1 className="font-semibold text-[calc(28rem/14)] tracking-tight">
            {t('Collaboration board')}
          </h1>
        </header>
        {enabled ? (
          <ActiveBoard onOpenTask={onOpenTask} onOpenGroup={onOpenGroup} />
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
