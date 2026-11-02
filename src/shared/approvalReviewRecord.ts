/** Device-local allow presets. The block threshold is always 0.9. */
export const APPROVAL_ALLOW_THRESHOLDS = [0.85, 0.9, 0.95] as const;
export type ApprovalAllowThreshold = (typeof APPROVAL_ALLOW_THRESHOLDS)[number];
export const DEFAULT_APPROVAL_ALLOW_THRESHOLD: ApprovalAllowThreshold = 0.9;
export function isApprovalAllowThreshold(value: unknown): value is ApprovalAllowThreshold {
  return (APPROVAL_ALLOW_THRESHOLDS as readonly unknown[]).includes(value);
}
export function parseApprovalAllowThreshold(value: unknown): ApprovalAllowThreshold {
  return isApprovalAllowThreshold(value) ? value : DEFAULT_APPROVAL_ALLOW_THRESHOLD;
}

export const APPROVAL_REVIEW_REASONS = [
  'read_only',
  'regenerable',
  'reversible_workspace_change',
  'data_loss',
  'system_state',
  'exfiltration',
  'unclear_target',
] as const;
export type ApprovalReviewReason = (typeof APPROVAL_REVIEW_REASONS)[number];
export const APPROVAL_REVIEW_FALLBACKS = ['timeout', 'error', 'invalid', 'too-large'] as const;
export type ApprovalReviewFallback = (typeof APPROVAL_REVIEW_FALLBACKS)[number];

export interface ApprovalProbabilities {
  allow: number;
  ask: number;
  block: number;
}
export type ApprovalReviewRecord = {
  model: string;
  actionHash: string;
} & (
  | (ApprovalProbabilities & { verdict: 'allow' | 'deny'; reason?: ApprovalReviewReason })
  | { verdict: 'fallback'; fallback: ApprovalReviewFallback }
);

export function isApprovalReviewReason(value: unknown): value is ApprovalReviewReason {
  return (APPROVAL_REVIEW_REASONS as readonly unknown[]).includes(value);
}
export function isProbability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

/** All three probabilities must be present; tolerate only floating-point rounding. */
export function readApprovalProbabilities(value: unknown): ApprovalProbabilities | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (
    Object.keys(raw).length !== 3 ||
    !['allow', 'ask', 'block'].every((key) => Object.hasOwn(raw, key))
  )
    return null;
  const { allow, ask, block } = raw;
  if (!isProbability(allow) || !isProbability(ask) || !isProbability(block)) return null;
  if (Math.abs(allow + ask + block - 1) > 0.001) return null;
  return { allow, ask, block };
}

/** Audit metadata never contains free-form model output, credentials, arguments or transcript. */
export function parseApprovalReviewRecord(value: unknown): ApprovalReviewRecord | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const { verdict, model, actionHash, reason, fallback } = raw;
  if (
    typeof model !== 'string' ||
    !/^[\w./:@+-]{1,200}$/.test(model) ||
    model.includes('://') ||
    typeof actionHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(actionHash)
  )
    return undefined;
  if (verdict === 'fallback') {
    return (APPROVAL_REVIEW_FALLBACKS as readonly unknown[]).includes(fallback)
      ? { verdict, model, actionHash, fallback: fallback as ApprovalReviewFallback }
      : undefined;
  }
  if (verdict !== 'allow' && verdict !== 'deny') return undefined;
  const probabilities = readApprovalProbabilities({
    allow: raw.allow,
    ask: raw.ask,
    block: raw.block,
  });
  if (!probabilities || (reason !== undefined && !isApprovalReviewReason(reason))) return undefined;
  return {
    verdict,
    model,
    actionHash,
    ...probabilities,
    ...(reason ? { reason: reason as ApprovalReviewReason } : {}),
  };
}
