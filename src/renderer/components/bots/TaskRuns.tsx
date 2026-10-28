import type {
  BotProfile,
  DelegationAppend,
  DelegationTrigger,
  GroupTaskRun,
} from '@shared/types/bot';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { type TFunction, useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { useBotsStore } from '@/stores/bots';
import { formatElapsed, isActiveDelegation } from '@/stores/bots/delegations';
import { taskRunRows } from '@/stores/bots/groupBoard';
import { BotAvatar } from './BotAvatar';
import { DelegationBadge, failureText, useNow } from './DelegationCard';

/** 默认只显示最近几次执行 */
const RECENT_RUNS = 5;

export function triggerText(trigger: DelegationTrigger, t: TFunction): string {
  switch (trigger) {
    case 'append':
      return t('Appended');
    case 'reply':
      return t('Resumed after reply');
    case 'rework':
      return t('Rework');
    case 'retry':
      return t('Retry');
    default:
      return t('Delegated');
  }
}

const timeOf = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const appendState = (append: DelegationAppend, t: TFunction) =>
  append.ok === undefined ? t('Processing') : append.ok ? t('Delivered') : t('Not delivered');

/** 并入这次执行的追加：时间、摘要、是否送达 */
export function TaskRunAppends({ appends }: { appends: readonly DelegationAppend[] }) {
  const { t } = useI18n();
  return (
    <ul className="mt-0.5 ml-6 space-y-0.5">
      {appends.map((append) => (
        <li key={append.deliveryId} className="flex items-center gap-1.5 text-muted-foreground">
          <span className="shrink-0 tabular-nums">{timeOf(append.at)}</span>
          <span className="min-w-0 flex-1 truncate text-foreground" title={append.text}>
            {append.text}
          </span>
          <span
            className={cn(
              'shrink-0 rounded px-1.5 text-[calc(11rem/14)]',
              append.ok === undefined
                ? 'bg-info/15 text-info'
                : append.ok
                  ? 'bg-success/15 text-success'
                  : 'bg-destructive/15 text-destructive'
            )}
          >
            {appendState(append, t)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** 任务卡「历次执行」：执行人、来源、状态、耗时、失败原因；转派缩进；查看过程按状态分流由上层处理 */
export function TaskRuns({
  runs,
  bots,
  onOpenConversation,
}: {
  runs: readonly GroupTaskRun[];
  bots: Map<string, BotProfile>;
  onOpenConversation: (conversationId: string, title: string) => void;
}) {
  const { t } = useI18n();
  const delegations = useBotsStore((s) => s.delegations);
  const now = useNow(runs.some((run) => isActiveDelegation(run.state)));
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const rows = taskRunRows(runs, delegations, now);
  const shown = all ? rows : rows.slice(-RECENT_RUNS);
  const nameOf = (id: string) => bots.get(id)?.name ?? t('Deleted member');
  return (
    <section className="mt-1.5 border-t pt-1.5">
      <h5 className="mb-1 text-[calc(11rem/14)] text-muted-foreground">
        {t('Run history')} · {rows.length}
      </h5>
      <ul className="space-y-1">
        {shown.map(({ run, record, time }) => {
          const failure = run.state === 'failed' ? failureText(record ?? run, t) : undefined;
          const appends = record?.appends ?? [];
          return (
            <li key={run.id} className={cn(run.nested && 'ml-3 border-l pl-2')}>
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-muted-foreground">
                <BotAvatar bot={bots.get(run.botId)} size="xs" />
                <span className="text-foreground">{nameOf(run.botId)}</span>
                <span>· {run.nested ? t('Sub-delegation') : triggerText(run.trigger, t)}</span>
                {time.queued ? (
                  <span className="rounded bg-info/15 px-1.5 text-[calc(11rem/14)] text-info">
                    {t('Queued {{time}}', { time: formatElapsed(time.ms) })}
                  </span>
                ) : (
                  <>
                    <DelegationBadge
                      state={run.state}
                      interrupted={run.failure === 'interrupted'}
                    />
                    <span>{formatElapsed(time.ms)}</span>
                  </>
                )}
                {run.appends && (
                  <button
                    type="button"
                    aria-expanded={open === run.id}
                    disabled={!appends.length}
                    title={appends
                      .map((item) => `${timeOf(item.at)} ${item.text} · ${appendState(item, t)}`)
                      .join('\n')}
                    onClick={() => setOpen(open === run.id ? null : run.id)}
                    className="rounded px-1 text-info hover:bg-info/10 disabled:hover:bg-transparent"
                  >
                    {t('+{{n}} appended', { n: run.appends })}
                  </button>
                )}
                <span className="flex-1" />
                {record && (
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() =>
                      onOpenConversation(
                        record.childConversationId,
                        t('{{from}} → {{to}} · Delegation', {
                          from: nameOf(record.parentBotId),
                          to: nameOf(record.targetBotId),
                        })
                      )
                    }
                  >
                    {t('View process')}
                  </Button>
                )}
              </div>
              {open === run.id && appends.length > 0 && <TaskRunAppends appends={appends} />}
              {failure && (
                <div className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-destructive">
                  {failure}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {rows.length > shown.length && (
        <Button size="xs" variant="ghost" onClick={() => setAll(true)}>
          {t('Show all ({{n}})', { n: rows.length })}
        </Button>
      )}
    </section>
  );
}
