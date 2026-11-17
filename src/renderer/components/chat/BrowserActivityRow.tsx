import { Globe } from 'lucide-react';
import { type TFunction, useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import type { BrowserLabel, BrowserToolView } from '@/stores/sessions/browserPresentation';
import { formatDuration } from '@/stores/sessions/stats';
import type { TimelineItem } from '@/stores/sessions/timeline';
import { ApprovalReviewBar } from './ApprovalReviewBar';
import { ToolSummaryRow } from './ToolSummaryRow';

const labelText = (label: BrowserLabel, t: TFunction) =>
  label.text ??
  t(label.key ?? 'Operate browser', label.target ? { target: label.target } : undefined);

/** Deliberately no JSON/argument/output card. Full technical results remain in authoritative history. */
export function BrowserActivityRow({
  item,
  view,
}: {
  item: Extract<TimelineItem, { kind: 'tool' }>;
  view: BrowserToolView;
}) {
  const { t } = useI18n();
  const busy = item.state === 'running' || item.state === 'reviewing';
  const failed = item.state === 'error';
  const labels = view.steps.length
    ? view.steps
    : [
        {
          ordinal: 0,
          label: view.label,
          status: busy
            ? ('running' as const)
            : failed
              ? ('failed' as const)
              : ('completed' as const),
        },
      ];
  return (
    <div
      data-browser-activity=""
      data-tool-nested={item.nested ? '' : undefined}
      className="min-w-0 space-y-1.5"
    >
      {labels.map((step) => {
        const label = labelText(step.label, t);
        return (
          <div
            key={`${item.key}:${step.ordinal}`}
            className={cn(
              'flex min-h-6 min-w-0 items-center gap-2 text-sm text-muted-foreground',
              step.status === 'failed' && 'text-destructive'
            )}
          >
            <Globe aria-hidden className="size-4 shrink-0 opacity-70" />
            <span
              className={cn('min-w-0 break-words', busy && !view.steps.length && 't-shimmer')}
              data-text={busy && !view.steps.length ? label : undefined}
            >
              {label}
            </span>
            {step.status === 'failed' && <span className="shrink-0 text-xs">{t('Failed')}</span>}
            {failed && step.status === 'pending' && (
              <span className="shrink-0 text-xs">{t('Not executed')}</span>
            )}
          </div>
        );
      })}
      {failed && (
        <div
          role="status"
          className="ml-6 whitespace-pre-wrap break-words text-sm text-destructive"
        >
          {view.error || t('Browser action did not finish.')}
        </div>
      )}
      {view.warning && (
        <div
          role="status"
          className="ml-6 whitespace-pre-wrap break-words text-sm text-amber-600 dark:text-amber-400"
        >
          {view.warning}
        </div>
      )}
      {item.approvalReview && <ApprovalReviewBar value={item.approvalReview} />}
    </div>
  );
}

export function BrowserActivityHead({
  item,
  onToggle,
}: {
  item: Extract<TimelineItem, { kind: 'tool-group' }>;
  onToggle?: (key: string) => void;
}) {
  const { t } = useI18n();
  const browser = item.browser!;
  return (
    <div data-browser-group="">
      <ToolSummaryRow
        kind={t(
          item.exploring ? 'Operating browser · {{count}} actions' : 'Used browser {{count}} times',
          { count: browser.count }
        )}
        summary={
          browser.thinkingMs !== null ? (
            <span>
              {t('Thought for {{duration}}', { duration: formatDuration(browser.thinkingMs) })}
            </span>
          ) : undefined
        }
        separator
        status={
          browser.failed > 0 || browser.warnings > 0 ? (
            <>
              {browser.failed > 0 && (
                <span className="shrink-0 text-destructive">
                  {t('{{count}} failed', { count: browser.failed })}
                </span>
              )}
              {browser.warnings > 0 && (
                <span className="shrink-0 text-amber-600 dark:text-amber-400">
                  {t('{{count}} to verify', { count: browser.warnings })}
                </span>
              )}
            </>
          ) : undefined
        }
        running={item.exploring}
        expanded={item.expanded}
        onToggle={() => onToggle?.(item.key)}
      />
    </div>
  );
}
