import { ChevronRight, ListOrdered, Pause, Play, Target, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from '@/components/ui/dialog';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import type { SessionGoal } from '@/stores/sessions';
import { useSessionsStore } from '@/stores/sessions';
import { GOAL_AUTO_TURN_LIMIT, goalSteps } from '@/stores/sessions/goalSteps';
import { summarizeSubagentToolArgs } from './subagentToolSummary';

/** 状态色点(与 TaskBar 同款):整条保持中性,状态只落在小点上 */
const STATUS_DOT: Record<SessionGoal['status'], string> = {
  active: 'bg-success animate-pulse',
  paused: 'bg-warning',
  waiting: 'bg-warning',
  blocked: 'bg-destructive',
  completed: 'bg-primary',
};

/** 会话目标状态条:目标文本 + 状态/轮数 + 暂停/继续/清除 */
export function GoalBar({ conversationId, goal }: { conversationId: string; goal: SessionGoal }) {
  const { t } = useI18n();
  const [detailsFor, setDetailsFor] = useState<(SessionGoal & { conversationId: string }) | null>(
    null
  );
  const open =
    detailsFor?.conversationId === conversationId &&
    detailsFor.text === goal.text &&
    detailsFor.createdAt === goal.createdAt;
  const statusLabel: Record<SessionGoal['status'], string> = {
    active: t('working'),
    paused: t('paused'),
    waiting: t('waiting'),
    blocked: t('blocked'),
    completed: t('completed'),
  };
  return (
    <div
      data-slot="goal-bar"
      className="mb-[6px] flex items-center gap-[8px] rounded-[6px] border border-border/70 bg-muted/45 px-[12px] py-[6px] text-[calc(12rem/14)]"
    >
      <Target className="size-[calc(14rem/14)] shrink-0 text-muted-foreground" />
      <button
        type="button"
        aria-label={t('View goal steps')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setDetailsFor({ ...goal, conversationId })}
        className="min-w-0 flex-1 truncate text-left hover:text-primary focus-visible:outline-ring"
        title={goal.note ? `${goal.text} — ${goal.note}` : goal.text}
      >
        {goal.text}
        {goal.note && <span className="text-muted-foreground"> — {goal.note}</span>}
      </button>
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', STATUS_DOT[goal.status])} />
      <span className="shrink-0 text-[calc(11rem/14)] text-muted-foreground tabular-nums">
        {statusLabel[goal.status]}
        {` · ${t('Auto runs {{current}}/{{limit}}', { current: goal.autoTurns, limit: GOAL_AUTO_TURN_LIMIT })}`}
      </span>
      <button
        type="button"
        title={t('View goal steps')}
        aria-label={t('View goal steps')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setDetailsFor({ ...goal, conversationId })}
        className="flex shrink-0 items-center gap-1 rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-ring"
      >
        <ListOrdered className="h-3.5 w-3.5" aria-hidden />
        <span>{t('Steps')}</span>
      </button>
      {goal.status === 'active' ? (
        <button
          type="button"
          title={t('Pause goal')}
          onClick={() => useSessionsStore.getState().pauseGoal(conversationId)}
          className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          <Pause className="h-3.5 w-3.5" />
        </button>
      ) : goal.status !== 'completed' ? (
        <button
          type="button"
          title={t('Resume goal')}
          onClick={() => useSessionsStore.getState().resumeGoal(conversationId)}
          className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          <Play className="h-3.5 w-3.5" />
        </button>
      ) : null}
      <button
        type="button"
        title={t('Clear goal')}
        onClick={() => useSessionsStore.getState().clearGoal(conversationId)}
        className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-destructive"
      >
        <X className="h-3.5 w-3.5" />
      </button>
      {open && (
        <GoalStepsDialog
          key={`${conversationId}:${goal.createdAt ?? goal.text}`}
          conversationId={conversationId}
          goal={goal}
          onClose={() => setDetailsFor(null)}
        />
      )}
    </div>
  );
}

function GoalStepsDialog({
  conversationId,
  goal,
  onClose,
}: {
  conversationId: string;
  goal: SessionGoal;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const conversation = useSessionsStore((state) => state.conversations[conversationId]);
  const steps = useMemo(
    () =>
      goalSteps(
        conversation?.messages ?? [],
        goal,
        conversation?.status ?? 'idle',
        conversation?.historyBaseIndex
      ),
    [conversation?.messages, conversation?.status, conversation?.historyBaseIndex, goal]
  );
  const statusLabels = {
    running: t('working'),
    ended: t('Run ended'),
    failed: t('failed'),
    pending: t('Waiting to start'),
  };
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-[720px]">
        <DialogHeader>
          <DialogTitle>{t('Goal steps')}</DialogTitle>
          <DialogDescription className="whitespace-pre-wrap break-words">
            {goal.text}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4 text-[calc(12rem/14)]">
          <p className="text-muted-foreground">
            {t(
              '{{limit}} is the automatic-run safety limit, not a predefined task list. These are the actual runs and tool actions from this conversation.',
              { limit: GOAL_AUTO_TURN_LIMIT }
            )}
          </p>
          {goal.note && <p className="whitespace-pre-wrap break-words">{goal.note}</p>}
          {(conversation?.historyBaseIndex ?? 0) > 0 && (
            <div className="space-y-2">
              <p className="text-muted-foreground">
                {t('Only loaded history is shown. Earlier runs may not be listed yet.')}
              </p>
              <Button
                variant="outline"
                size="sm"
                disabled={conversation?.historyLoading}
                onClick={() => void useSessionsStore.getState().loadOlderHistory(conversationId)}
              >
                {conversation?.historyLoading ? t('Loading...') : t('Load earlier runs')}
              </Button>
            </div>
          )}
          {conversation?.historyError && (
            <p role="alert" className="text-destructive">
              {conversation.historyError}
            </p>
          )}
          {steps.length === 0 ? (
            <p className="rounded-md border border-dashed px-3 py-6 text-center text-muted-foreground">
              {t('No goal runs in the loaded history yet.')}
            </p>
          ) : (
            <ol className="space-y-2" data-slot="goal-steps">
              {steps.map((step) => {
                const label =
                  step.kind === 'start'
                    ? t('Goal kickoff')
                    : step.kind === 'resume'
                      ? t('Goal resumed')
                      : t('Auto run {{n}}', { n: step.number ?? 0 });
                return (
                  <li key={step.index}>
                    <details
                      className="group rounded-md border border-border/70"
                      data-goal-step={step.index}
                    >
                      <summary className="flex cursor-pointer list-none items-start gap-2 rounded-md px-3 py-2 hover:bg-muted/50 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                        <ChevronRight
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 group-open:rotate-90"
                          aria-hidden
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className="font-medium">{label}</span>
                            <span
                              className={cn(
                                'text-[calc(11rem/14)] text-muted-foreground',
                                step.status === 'running' && 'text-success',
                                step.status === 'failed' && 'text-destructive'
                              )}
                            >
                              {statusLabels[step.status]}
                            </span>
                            {step.tools.length > 0 && (
                              <span className="text-muted-foreground">
                                {t('{{n}} tool actions', { n: step.tools.length })}
                              </span>
                            )}
                          </div>
                          <p className="mt-1 line-clamp-2 whitespace-pre-wrap break-words text-muted-foreground">
                            {step.output ||
                              step.tools.map((tool) => tool.name).join(' · ') ||
                              t('No reply yet')}
                          </p>
                        </div>
                      </summary>
                      <div className="space-y-3 px-3 pb-3 pl-8">
                        {step.tools.length > 0 && (
                          <ul className="space-y-1 text-muted-foreground">
                            {step.tools.map((tool) => (
                              <li key={tool.id} className="break-words">
                                <span className="font-medium text-foreground">{tool.name}</span>{' '}
                                {summarizeSubagentToolArgs(tool.name, tool.arguments)}
                              </li>
                            ))}
                          </ul>
                        )}
                        {step.output && (
                          <p className="whitespace-pre-wrap break-words leading-relaxed">
                            {step.output}
                          </p>
                        )}
                      </div>
                    </details>
                  </li>
                );
              })}
            </ol>
          )}
        </DialogPanel>
      </DialogContent>
    </Dialog>
  );
}
