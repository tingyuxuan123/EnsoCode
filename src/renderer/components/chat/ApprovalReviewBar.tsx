import { type ApprovalReviewReason, parseApprovalReviewRecord } from '@shared/approvalReviewRecord';
import { useI18n } from '@/i18n';
import { REVIEW_FALLBACK_LABELS } from './ApprovalBar';

export const APPROVAL_REVIEW_REASON_LABELS: Record<ApprovalReviewReason, string> = {
  read_only: 'Read-only',
  regenerable: 'Regenerable output',
  reversible_workspace_change: 'Reversible workspace change',
  data_loss: 'Possible data loss',
  system_state: 'Changes system state',
  exfiltration: 'Sends data externally',
  unclear_target: 'Unclear target or intent',
};

/** Whitelisted review metadata survives both live results and JSONL restoration. */
export function ApprovalReviewBar({ value }: { value: unknown }) {
  const record = parseApprovalReviewRecord(value);
  const { t } = useI18n();
  if (!record) return null;
  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-1.5 border-border/60 border-t px-3 py-1 text-[10px] text-muted-foreground"
      data-approval-review={record.verdict}
    >
      <span className="font-semibold text-foreground/75">
        {record.verdict === 'allow'
          ? t('Auto-managed · allowed')
          : record.verdict === 'deny'
            ? t('Auto-managed · denied')
            : t('Auto-managed · asks you')}
      </span>
      <span aria-hidden="true">·</span>
      <span className="font-mono">{record.model}</span>
      {record.verdict === 'fallback' ? (
        <span>{t(REVIEW_FALLBACK_LABELS[record.fallback])}</span>
      ) : (
        <>
          <span className="font-mono">{`allow ${record.allow.toFixed(2)} · ask ${record.ask.toFixed(2)} · block ${record.block.toFixed(2)}`}</span>
          {record.reason && (
            <span>
              {t('Reason')}: {t(APPROVAL_REVIEW_REASON_LABELS[record.reason])}
            </span>
          )}
        </>
      )}
    </div>
  );
}
