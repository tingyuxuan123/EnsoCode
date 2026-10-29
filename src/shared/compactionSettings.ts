export const COMPACT_RESERVE_TOKENS_DEFAULT = 16384;
export const COMPACT_RESERVE_TOKENS_MIN = 4096;
export const COMPACT_RESERVE_TOKENS_MAX = 65536;

export type CompactReserveTokensError =
  | 'invalid-value'
  | 'invalid-file'
  | 'locked'
  | 'io-error'
  | 'forbidden';
export type CompactReserveTokensResult =
  | { ok: true }
  | { ok: false; error: CompactReserveTokensError };
export type CompactReserveTokensReadResult =
  | { ok: true; value: number | null }
  | { ok: false; error: CompactReserveTokensError };

/** null 删除覆盖值；其余只接受范围内整数，不在 Main 隐式转换字符串。 */
export function parseCompactReserveTokens(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= COMPACT_RESERVE_TOKENS_MIN &&
    value <= COMPACT_RESERVE_TOKENS_MAX
    ? value
    : undefined;
}

export function parseCompactReserveTokensDraft(draft: string): number | null | undefined {
  const trimmed = draft.trim();
  if (!trimmed) return null;
  return /^\d+$/.test(trimmed) ? parseCompactReserveTokens(Number(trimmed)) : undefined;
}
