import type {
  BotProfile,
  Delegation,
  DelegationAppend,
  DelegationState,
  TaskCheck,
} from '@shared/types/bot';
import { ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { addToast } from '@/components/ui/toast';
import { type TFunction, useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { useBotsStore } from '@/stores/bots';
import { delegationActions, formatElapsed, isActiveDelegation } from '@/stores/bots/delegations';
import { BotAvatar } from './BotAvatar';
import { PresenceChip, useDelegationPresence } from './PresenceMark';

const timeOf = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export function DelegationBadge({ state, interrupted }: { state: string; interrupted?: boolean }) {
  const { t } = useI18n();
  const tone =
    state === 'running' || state === 'queued'
      ? 'bg-info/15 text-info'
      : state === 'completed'
        ? 'bg-success/15 text-success'
        : state === 'failed'
          ? 'bg-destructive/15 text-destructive'
          : state === 'blocked'
            ? 'bg-warning/15 text-warning'
            : 'bg-muted text-muted-foreground';
  const label: Record<string, string> = {
    queued: t('Queued'),
    running: t('In progress'),
    completed: t('Completed'),
    failed: interrupted ? t('Interrupted') : t('Failed'),
    canceled: t('Canceled'),
    blocked: t('Stuck run'),
  };
  return (
    <span className={cn('rounded px-1.5 text-[calc(11rem/14)]', tone)}>
      {label[state] ?? state}
    </span>
  );
}

/** 验收条件与最近一次校验结果 */
export function CheckBadge({ check, className }: { check: TaskCheck; className?: string }) {
  const { t } = useI18n();
  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-1.5 text-muted-foreground text-[calc(11rem/14)]',
        className
      )}
    >
      <span className="shrink-0">{t('Acceptance check')}</span>
      <code className="min-w-0 truncate rounded bg-muted px-1" title={check.text}>
        {check.text}
      </code>
      {check.passed !== undefined && (
        <span
          className={cn(
            'shrink-0 rounded px-1.5 text-[calc(11rem/14)]',
            check.passed ? 'bg-success/15 text-success' : 'bg-destructive/15 text-destructive'
          )}
        >
          {check.passed ? t('Passed') : t('Not passed')}
        </span>
      )}
    </div>
  );
}

export function failureText(
  record: Pick<Delegation, 'failure' | 'error' | 'timeoutMinutes' | 'check'>,
  t: TFunction
): string | undefined {
  switch (record.failure) {
    case 'interrupted':
      return t('The app restarted before this task finished. It was stopped and will not rerun.');
    case 'timeout':
      return t('Timed out after {{n}} minutes.', { n: record.timeoutMinutes ?? 240 });
    case 'denied':
      return t('Denied.');
    case 'check':
      return t('Acceptance check failed: "{{text}}" not found in tool outputs.', {
        text: record.check?.text ?? '',
      });
    default:
      return record.error === 'budget-exceeded'
        ? t("The member's daily budget is used up.")
        : record.error === 'turn-token-limit'
          ? t("Stopped: the member's per-turn token limit was exceeded.")
          : record.error;
  }
}

export function cancelDelegation(id: string, t: TFunction): void {
  void window.electronAPI.bots.cancelDelegation(id).then((result) => {
    if (!result.ok)
      addToast({ type: 'error', title: t('Cancel failed'), description: result.error });
    void useBotsStore.getState().refreshDelegations();
  });
}

export function retryDelegation(id: string, t: TFunction, mode?: 'resume' | 'restart'): void {
  void window.electronAPI.bots.retryDelegation(id, mode).then((result) => {
    if (!result.ok)
      addToast({ type: 'error', title: t('Retry failed'), description: result.error });
    else if (result.warning) addToast({ type: 'warning', title: result.warning });
    void useBotsStore.getState().refreshDelegations();
  });
}

/** 进行中的委派每 30 秒刷新耗时 */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

interface DelegationCardProps {
  /** 委派记录；时间线旧条目找不到记录时只按条目渲染 */
  record?: Delegation;
  entry?: {
    from: string;
    to: string;
    state: DelegationState;
    summary?: string;
    at: number;
    /** 挂了看板任务的结果卡：群里已有进度行，默认折叠 */
    taskId?: string;
  };
  /** 已被重试：不再给重试按钮 */
  retried?: boolean;
  /** 并入 record 这次执行的追加：标「已并入」，不单独显示状态与结果 */
  append?: DelegationAppend;
  taskSeq?: number;
  bots: Map<string, BotProfile>;
  onOpenConversation: (conversationId: string, title: string) => void;
}

/** 委派卡片：发起人 → 目标、任务、状态与耗时、结果摘要，按状态给取消 / 重试 / 查看过程 */
export function DelegationCard({
  record,
  entry,
  retried,
  append,
  taskSeq,
  bots,
  onOpenConversation,
}: DelegationCardProps) {
  const { t } = useI18n();
  const state = record?.state ?? entry?.state ?? 'queued';
  const now = useNow(!append && isActiveDelegation(state));
  const from = bots.get(record?.parentBotId ?? entry?.from ?? '');
  const to = bots.get(record?.targetBotId ?? entry?.to ?? '');
  const actions = delegationActions(append ? 'completed' : state);
  const presence = useDelegationPresence(record);
  const active = !append && presence && isActiveDelegation(state);
  const blocked = !append && state === 'blocked' ? record?.blocked : undefined;
  // 卡住后同任务已有新执行（有人回复 / 重试）：不再催回复
  const answered = useBotsStore((s) =>
    blocked && record?.taskId
      ? s.delegations.some(
          (item) => item.taskId === record.taskId && item.createdAt > record.createdAt
        )
      : false
  );
  const openTask = useBotsStore((s) => s.openTask);
  const collapsible = Boolean(entry?.taskId) && !append;
  const [open, setOpen] = useState(!collapsible);
  const summary = append
    ? undefined
    : record
      ? state === 'completed'
        ? record.result
        : state === 'blocked'
          ? undefined
          : failureText(record, t)
      : entry?.summary;
  const title = t('{{from}} → {{to}} · Delegation', {
    from: from?.name ?? t('Deleted member'),
    to: to?.name ?? t('Deleted member'),
  });
  const header = (
    <>
      {collapsible && (
        <ChevronRight
          aria-hidden
          className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-90')}
        />
      )}
      <BotAvatar bot={from} size="xs" />
      <span className="text-foreground">{from?.name ?? t('Deleted member')}</span>
      <span>→</span>
      <BotAvatar bot={to} size="xs" presence={presence?.state} />
      <span className="text-foreground">{to?.name ?? t('Deleted member')}</span>
      <span>· {t('Delegation')}</span>
      {append ? (
        <span className="rounded bg-info/15 px-1.5 text-[calc(11rem/14)] text-info">
          {taskSeq === undefined
            ? t('Merged into the current run')
            : t('Merged into the current run of #{{n}}', { n: taskSeq })}
        </span>
      ) : active ? (
        <PresenceChip info={presence} />
      ) : (
        <DelegationBadge state={state} interrupted={record?.failure === 'interrupted'} />
      )}
      {record && !append && (
        <span>{formatElapsed((record.finishedAt ?? now) - record.createdAt)}</span>
      )}
      <span className="flex-1" />
      <span>{timeOf(append?.at ?? entry?.at ?? record?.createdAt ?? now)}</span>
    </>
  );
  const headerClass =
    'flex flex-wrap items-center gap-1.5 whitespace-nowrap text-muted-foreground text-[calc(11rem/14)]';
  const task = append?.text ?? record?.task;
  return (
    <div data-slot="bot-card" className="max-w-lg rounded-md border bg-card px-3 py-2.5">
      {collapsible ? (
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? t('Collapse delegation result') : t('Expand delegation result')}
          className={cn(headerClass, 'w-full rounded text-left hover:text-foreground')}
          onClick={() => setOpen((value) => !value)}
        >
          {header}
        </button>
      ) : (
        <div className={headerClass}>{header}</div>
      )}
      {!open && task && (
        <div className="mt-1 truncate text-muted-foreground text-[calc(11rem/14)]">{task}</div>
      )}
      {open && task && <div className="mt-1.5 line-clamp-3 text-sm">{task}</div>}
      {open && (
        <>
          {record?.check && !append && <CheckBadge check={record.check} className="mt-1.5" />}
          {summary && (
            <div className="mt-1.5 line-clamp-4 whitespace-pre-wrap text-muted-foreground text-[calc(11rem/14)]">
              {summary}
            </div>
          )}
          {blocked && record && (
            <div className="mt-1.5 rounded-md bg-warning/10 px-2 py-1 text-[calc(11rem/14)]">
              <div className="line-clamp-4 whitespace-pre-wrap">
                {t('Blocked · needs: {{need}}', { need: blocked.need })}
              </div>
              <div className="text-muted-foreground">
                {answered
                  ? t('Answered; the work continues')
                  : blocked.waitFor === 'parent'
                    ? t('Waiting for {{name}} to reply', {
                        name: from?.name ?? t('Deleted member'),
                      })
                    : t('Waiting for your reply')}
              </div>
            </div>
          )}
          {record && (
            <div className="mt-2 flex justify-end gap-1.5">
              <Button
                size="xs"
                variant="ghost"
                onClick={() => onOpenConversation(record.childConversationId, title)}
              >
                {t('View process')}
              </Button>
              {blocked && !answered && record.chatId && record.taskId && (
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() =>
                    record.chatId && record.taskId && openTask(record.chatId, record.taskId)
                  }
                >
                  {t('Reply')}
                </Button>
              )}
              {actions.cancel && (
                <Button size="xs" variant="outline" onClick={() => cancelDelegation(record.id, t)}>
                  {t('Cancel')}
                </Button>
              )}
              {actions.retry && !retried && (
                <Button size="xs" variant="outline" onClick={() => retryDelegation(record.id, t)}>
                  {t('Retry')}
                </Button>
              )}
              {actions.resumeOrRestart && !retried && (
                <>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => retryDelegation(record.id, t, 'resume')}
                  >
                    {t('Continue')}
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => retryDelegation(record.id, t, 'restart')}
                  >
                    {t('Start over')}
                  </Button>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
