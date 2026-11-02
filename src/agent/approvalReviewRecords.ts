import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import { type ApprovalReviewRecord, parseApprovalReviewRecord } from '@shared/approvalReviewRecord';

const records = new Map<string, ApprovalReviewRecord>();
const key = (scope: string, toolCallId: string) => JSON.stringify([scope, toolCallId]);

/** Scope is pi session identity, not the model-controlled tool call id alone. */
export function rememberApprovalReview(
  scope: string,
  toolCallId: string,
  record: ApprovalReviewRecord
): void {
  const safe = parseApprovalReviewRecord(record);
  if (!safe) return;
  const id = key(scope, toolCallId);
  records.delete(id);
  records.set(id, safe);
  while (records.size > 200) records.delete(records.keys().next().value as string);
}
export function takeApprovalReview(
  scope: string,
  toolCallId: string
): ApprovalReviewRecord | undefined {
  const id = key(scope, toolCallId);
  const record = records.get(id);
  records.delete(id);
  return record;
}

export const approvalReviewResultExtension: InlineExtension = {
  name: 'approval-review-result',
  hidden: true,
  factory: (pi) => {
    pi.on('tool_result', (event, ctx) => {
      const record = takeApprovalReview(ctx.sessionManager.getSessionId(), event.toolCallId);
      const details: Record<string, unknown> =
        event.details && typeof event.details === 'object' && !Array.isArray(event.details)
          ? { ...event.details }
          : {};
      if (!record) {
        if (!Object.hasOwn(details, 'approvalReview')) return;
        const { approvalReview: _untrusted, ...safe } = details;
        return { details: safe };
      }
      return { details: { ...details, approvalReview: record } };
    });
  },
};
