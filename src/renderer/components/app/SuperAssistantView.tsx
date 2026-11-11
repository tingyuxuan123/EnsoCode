import type { SuperAssistantTask } from '@shared/superAssistant';
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  Hand,
  ListChecks,
  LoaderCircle,
  Orbit,
  Search,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { ChatView } from '@/components/chat/ChatView';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { useSessionsStore } from '@/stores/sessions';

const STATUS = {
  waiting: { label: 'Needs your attention', Icon: Hand, tone: 'text-warning' },
  running: {
    label: 'In progress',
    Icon: LoaderCircle,
    tone: 'text-brand motion-safe:animate-spin',
  },
  queued: { label: 'Queued', Icon: Clock3, tone: 'text-muted-foreground' },
  finished: { label: 'Run finished', Icon: Check, tone: 'text-success' },
  failed: { label: 'Failed', Icon: CircleAlert, tone: 'text-destructive' },
  canceled: { label: 'Canceled', Icon: X, tone: 'text-muted-foreground' },
} as const;

const GROUPS = [
  { key: 'waiting', label: 'Needs your attention', statuses: ['waiting'] },
  { key: 'running', label: 'In progress', statuses: ['running'] },
  { key: 'queued', label: 'Queued', statuses: ['queued'] },
  { key: 'finished', label: 'Past runs', statuses: ['finished', 'failed', 'canceled'] },
] as const;

export function SuperAssistantView({
  activityOpen,
  onOpenConversation,
}: {
  activityOpen: boolean;
  onOpenConversation(conversationId: string): void;
}) {
  const { t } = useI18n();
  const [conversationId, setConversationId] = useState<string>();
  const [tasks, setTasks] = useState<SuperAssistantTask[]>([]);
  const [openError, setOpenError] = useState<string>();
  const [activityError, setActivityError] = useState<string>();
  const [retry, setRetry] = useState(0);
  const hasConversation = useSessionsStore((state) =>
    conversationId ? Boolean(state.conversations[conversationId]?.superAssistant) : false
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: retry explicitly reopens the workspace and refreshes the snapshot.
  useEffect(() => {
    const api = window.electronAPI.superAssistant;
    let disposed = false;
    let receivedPush = false;
    setOpenError(undefined);
    setActivityError(undefined);
    const apply = (snapshot: Awaited<ReturnType<typeof api.snapshot>>) => {
      if (!snapshot.ok) {
        setActivityError(snapshot.error || t('Execution activity unavailable'));
        return;
      }
      setActivityError(undefined);
      setTasks(snapshot.tasks);
    };
    const off = api.onChanged((snapshot) => {
      if (disposed) return;
      receivedPush = true;
      apply(snapshot);
    });
    void api.open().then(
      (result) => {
        if (disposed) return;
        if (result.ok && result.conversationId) setConversationId(result.conversationId);
        else setOpenError(result.error || t('Could not open Super Assistant'));
      },
      () => {
        if (!disposed) setOpenError(t('Could not open Super Assistant'));
      }
    );
    void api.snapshot().then(
      (snapshot) => {
        if (!disposed && !receivedPush) apply(snapshot);
      },
      () => {
        if (!disposed && !receivedPush) setActivityError(t('Execution activity unavailable'));
      }
    );
    return () => {
      disposed = true;
      off();
    };
  }, [retry, t]);

  useEffect(() => {
    if (!conversationId || !hasConversation) return;
    return useSessionsStore.getState().acquireObservation(conversationId);
  }, [conversationId, hasConversation]);

  return (
    <main
      data-slot="super-assistant-workspace"
      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-line border-l border-t bg-background sm:flex-row"
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {conversationId && hasConversation ? (
          <ChatView key={conversationId} superAssistantId={conversationId} />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <Orbit className="size-8 text-brand" aria-hidden />
            <p className="font-semibold text-lg">{t('Super Assistant')}</p>
            <p
              className="max-w-md text-muted-foreground text-sm"
              role={openError ? 'alert' : 'status'}
            >
              {openError ?? t('Opening Super Assistant…')}
            </p>
            {openError && (
              <Button variant="outline" size="sm" onClick={() => setRetry((n) => n + 1)}>
                {t('Retry')}
              </Button>
            )}
          </div>
        )}
      </div>
      {activityOpen && (
        <SuperAssistantActivity
          tasks={tasks}
          error={activityError}
          onRetry={() => setRetry((n) => n + 1)}
          onOpenConversation={onOpenConversation}
        />
      )}
    </main>
  );
}

function SuperAssistantActivity({
  tasks,
  error,
  onRetry,
  onOpenConversation,
}: {
  tasks: readonly SuperAssistantTask[];
  error?: string;
  onRetry(): void;
  onOpenConversation(conversationId: string): void;
}) {
  const { t, locale } = useI18n();
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string>();
  const [confirmCancel, setConfirmCancel] = useState<string>();
  const [canceling, setCanceling] = useState<string>();
  const [cancelError, setCancelError] = useState<{ id: string; message: string }>();
  const match = query.trim().toLocaleLowerCase();
  const visible = tasks.filter((task) =>
    [task.title, task.projectName, task.prompt].some((text) =>
      text.toLocaleLowerCase().includes(match)
    )
  );
  const activeCount = tasks.filter(
    ({ status }) => status === 'waiting' || status === 'queued' || status === 'running'
  ).length;

  async function cancel(taskId: string) {
    setCanceling(taskId);
    setCancelError(undefined);
    try {
      const result = await window.electronAPI.superAssistant.cancel(taskId);
      if (!result.ok)
        setCancelError({ id: taskId, message: result.error || t('Could not stop this task') });
    } catch {
      setCancelError({ id: taskId, message: t('Could not stop this task') });
    } finally {
      setCanceling(undefined);
      setConfirmCancel(undefined);
    }
  }

  return (
    <aside
      data-slot="super-assistant-activity"
      aria-label={t('Execution activity')}
      className="flex min-h-0 max-h-[42%] w-full shrink-0 flex-col border-line border-t bg-nav sm:max-h-none sm:w-[clamp(280px,34%,410px)] sm:border-t-0 sm:border-l"
    >
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 pt-4 pb-3">
        <h2 className="flex items-center gap-2 font-semibold text-sm">
          <ListChecks className="size-4 text-muted-foreground" aria-hidden />
          {t('Execution activity')}
        </h2>
        <span className="text-muted-foreground text-xs tabular-nums" aria-live="polite">
          {t('{{n}} active', { n: activeCount })}
        </span>
      </header>
      {tasks.length > 0 && (
        <div className="relative mx-4 mb-2 shrink-0">
          <Search
            className="pointer-events-none absolute top-2.5 left-2.5 z-10 size-3.5 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={t('Filter dispatched tasks')}
            placeholder={t('Filter dispatched tasks')}
            className="h-8 w-full text-xs [&_input]:pl-8"
          />
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {error && (
          <div
            className="m-1 flex items-start justify-between gap-2 rounded-md bg-destructive/10 p-3 text-sm"
            role="alert"
          >
            {error}
            <Button variant="ghost" size="sm" onClick={onRetry}>
              {t('Retry')}
            </Button>
          </div>
        )}
        {!error && visible.length === 0 && (
          <div className="mx-1 mt-3 rounded-md border border-dashed px-4 py-6 text-center">
            <p className="font-medium text-sm">
              {match ? t('No matching tasks') : t('No dispatched tasks yet')}
            </p>
            {!match && (
              <p className="mt-1 text-muted-foreground text-xs leading-relaxed">
                {t('Tasks appear here as the assistant hands them off to Code conversations.')}
              </p>
            )}
          </div>
        )}
        {GROUPS.map(({ key, label, statuses }) => {
          const group = visible
            .filter((task) => statuses.some((status) => task.status === status))
            .sort((a, b) => b.updatedAt - a.updatedAt);
          if (!group.length) return null;
          return (
            <section key={key} aria-label={t(label)} className="mt-3">
              <h3 className="mb-1.5 px-2 font-medium text-muted-foreground text-xs">
                {t(label)} <span className="ml-1 tabular-nums">{group.length}</span>
              </h3>
              <ul className="space-y-1.5">
                {group.map((task) => {
                  const { Icon, tone, label: statusLabel } = STATUS[task.status];
                  const open = expanded === task.id;
                  const canCancel =
                    task.status === 'queued' ||
                    task.status === 'running' ||
                    task.status === 'waiting';
                  const detail = task.error ?? task.summary;
                  return (
                    <li
                      key={task.id}
                      data-task-status={task.status}
                      className={cn('rounded-lg', open && 'bg-accent/55')}
                    >
                      <button
                        type="button"
                        aria-expanded={open}
                        onClick={() => setExpanded(open ? undefined : task.id)}
                        className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left hover:bg-accent/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Icon className={cn('size-4', tone)} aria-hidden />
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-sm">{task.title}</span>
                          <span className="block truncate text-muted-foreground text-xs">
                            {task.projectName} · {t(statusLabel)}
                            {detail ? ` · ${detail}` : ''}
                          </span>
                        </span>
                        <ChevronRight
                          className={cn('size-3.5 text-muted-foreground', open && 'rotate-90')}
                          aria-hidden
                        />
                      </button>
                      {open && (
                        <div className="space-y-2 px-3 pb-3 pl-9 text-xs">
                          <p className="break-words whitespace-pre-wrap text-muted-foreground">
                            {task.prompt}
                          </p>
                          {detail && <p className="break-words whitespace-pre-wrap">{detail}</p>}
                          <p className="text-muted-foreground">
                            {new Date(task.updatedAt).toLocaleString(locale, {
                              dateStyle: 'short',
                              timeStyle: 'short',
                            })}
                          </p>
                          {cancelError?.id === task.id && (
                            <p role="alert" className="text-destructive">
                              {cancelError.message}
                            </p>
                          )}
                          <div className="flex flex-wrap items-center gap-1">
                            {task.conversationId && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => onOpenConversation(task.conversationId)}
                              >
                                {t('Open conversation')} <ArrowUpRight className="size-3" />
                              </Button>
                            )}
                            {canCancel &&
                              (confirmCancel === task.id ? (
                                <>
                                  <Button
                                    variant="destructive"
                                    size="sm"
                                    disabled={canceling !== undefined}
                                    onClick={() => void cancel(task.id)}
                                  >
                                    {t('Confirm stop')}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={canceling !== undefined}
                                    onClick={() => setConfirmCancel(undefined)}
                                  >
                                    {t('Keep running')}
                                  </Button>
                                </>
                              ) : (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setConfirmCancel(task.id)}
                                >
                                  {t('Stop task')}
                                </Button>
                              ))}
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </aside>
  );
}
