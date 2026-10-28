import { type PlanDoc, type PlanState, planPhase } from '@shared/planMode';
import type { ApprovalMode } from '@shared/types/agent';
import { ChevronDown, ChevronRight, ClipboardCheck, ClipboardList, X } from 'lucide-react';
import { useState } from 'react';
import { Popover, PopoverPopup, PopoverTrigger } from '@/components/ui/popover';
import { addToast } from '@/components/ui/toast';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { useSessionsStore } from '@/stores/sessions';
import {
  APPROVAL_MODE_META,
  APPROVAL_MODE_ORDER,
  useApprovalReviewerReady,
} from './ApprovalModePicker';
import { Markdown } from './Markdown';

const BAR =
  'mb-[6px] rounded-[6px] border border-border/70 bg-muted/45 px-[12px] py-[8px] text-[12px]';

function PlanPreview({ doc }: { doc: PlanDoc }) {
  return (
    <div className="scroll-stable mt-[8px] max-h-[190px] overflow-y-auto rounded-[4px] border border-line bg-background px-[12px] py-[8px] text-[12px] leading-[24px]">
      <Markdown text={doc.text} />
    </div>
  );
}

/** composer 上方的计划条：待审批时审批，执行中时提示与结束 */
export function PlanBar({
  conversationId,
  planState,
  approvalMode,
}: {
  conversationId: string;
  planState?: PlanState;
  approvalMode: ApprovalMode;
}) {
  const phase = planPhase(planState);
  if (phase === 'awaiting_review' && planState?.pending) {
    return (
      <PlanReviewBar
        key={planState.pending.planId}
        conversationId={conversationId}
        doc={planState.pending}
        approvalMode={approvalMode}
      />
    );
  }
  if (phase === 'executing' && planState?.executing) {
    return (
      <PlanExecutingBar
        key={planState.executing.planId}
        conversationId={conversationId}
        doc={planState.executing}
      />
    );
  }
  return null;
}

function PlanReviewBar({
  conversationId,
  doc,
  approvalMode,
}: {
  conversationId: string;
  doc: PlanDoc;
  approvalMode: ApprovalMode;
}) {
  const { t } = useI18n();
  const reviewerReady = useApprovalReviewerReady();
  const [expanded, setExpanded] = useState(true);
  const [revising, setRevising] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [modeOpen, setModeOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const respond = async (action: 'approve' | 'revise' | 'discard', mode?: ApprovalMode) => {
    setBusy(true);
    const store = useSessionsStore.getState();
    if (mode && mode !== approvalMode) store.setApprovalMode(conversationId, mode);
    const error = await store.respondPlan(
      conversationId,
      doc.planId,
      action,
      action === 'revise' ? feedback.trim() : undefined
    );
    if (error) {
      setBusy(false);
      addToast({ type: 'error', title: t('Plan response failed'), description: error });
    }
  };

  return (
    <div className={BAR}>
      <div className="flex items-center gap-2">
        <ClipboardList className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="shrink-0 text-[11px] font-medium text-muted-foreground">
          {t('Plan awaiting approval')}
        </span>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-1 text-left font-medium"
          title={doc.title}
        >
          <span className="truncate">{doc.title}</span>
          <ChevronRight
            className={cn('h-3 w-3 shrink-0 transition-transform', expanded && 'rotate-90')}
          />
        </button>
      </div>
      {expanded && <PlanPreview doc={doc} />}
      {revising && (
        <textarea
          // biome-ignore lint/a11y/noAutofocus: 用户点了「修改意见」，直接聚焦输入
          autoFocus
          value={feedback}
          onChange={(event) => setFeedback(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && feedback.trim()) {
              event.preventDefault();
              void respond('revise');
            }
          }}
          placeholder={t('What should change in this plan?')}
          className="mt-2 min-h-16 w-full resize-y rounded-md border border-border/60 bg-background px-2.5 py-1.5 text-sm outline-none focus:border-brand/45"
        />
      )}
      <div className="mt-2 flex items-center justify-end gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={() => void respond('discard')}
          className="rounded-md px-2.5 py-1 text-xs text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
        >
          {t('Discard and exit plan mode')}
        </button>
        {revising ? (
          <button
            type="button"
            disabled={busy || !feedback.trim()}
            onClick={() => void respond('revise')}
            className="rounded-md px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            {t('Send feedback')}
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => setRevising(true)}
            className="rounded-md px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            {t('Request changes')}
          </button>
        )}
        <div className="flex">
          <button
            type="button"
            disabled={busy}
            onClick={() => void respond('approve')}
            title={t(APPROVAL_MODE_META[approvalMode].labelKey)}
            className="rounded-l-md bg-primary px-2.5 py-1 text-xs text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {t('Approve and execute')}
          </button>
          <Popover open={modeOpen} onOpenChange={setModeOpen}>
            <PopoverTrigger
              disabled={busy}
              aria-label={t('Choose the approval mode for execution')}
              className="flex items-center rounded-r-md border-primary-foreground/20 border-l bg-primary px-1 text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </PopoverTrigger>
            <PopoverPopup
              side="top"
              align="end"
              className="w-80 [&_[data-slot=popover-viewport]]:p-1"
            >
              <p className="px-2 pt-1 pb-1.5 text-muted-foreground text-xs">
                {t('Approve and execute with')}
              </p>
              {APPROVAL_MODE_ORDER.map((option) => {
                const meta = APPROVAL_MODE_META[option];
                const Icon = meta.icon;
                const disabled = option === 'assistant' && !reviewerReady;
                return (
                  <button
                    key={option}
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      setModeOpen(false);
                      void respond('approve', option);
                    }}
                    className={cn(
                      'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                      option === approvalMode ? 'bg-muted' : 'hover:bg-muted/60',
                      disabled && 'cursor-not-allowed opacity-50 hover:bg-transparent'
                    )}
                  >
                    <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block">{t(meta.labelKey)}</span>
                      <span className="block text-xs text-muted-foreground">{t(meta.descKey)}</span>
                    </span>
                  </button>
                );
              })}
            </PopoverPopup>
          </Popover>
        </div>
      </div>
    </div>
  );
}

function PlanExecutingBar({ conversationId, doc }: { conversationId: string; doc: PlanDoc }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  return (
    <div className={cn(BAR, 'py-1.5')}>
      <div className="flex items-center gap-2">
        <ClipboardCheck className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="shrink-0 text-muted-foreground">{t('Executing plan')}</span>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-1 text-left"
          title={doc.title}
        >
          <span className="truncate">{doc.title}</span>
          <ChevronRight
            className={cn('h-3 w-3 shrink-0 transition-transform', expanded && 'rotate-90')}
          />
        </button>
        <button
          type="button"
          title={t('Finish plan')}
          onClick={() =>
            void useSessionsStore.getState().respondPlan(conversationId, doc.planId, 'finish')
          }
          className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {expanded && <PlanPreview doc={doc} />}
    </div>
  );
}
