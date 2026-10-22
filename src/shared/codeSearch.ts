/** Code search is opt-in because selected workspace text is sent to Devin. */
export const CODE_SEARCH_DEFAULT_OFF_SETTINGS_VERSION = 17;

export interface CodeSearchConfig {
  accountKey: string | null;
  revision: number;
}

export function parseCodeSearchAccountKey(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 80) return null;
  const key = value.trim();
  if (key === 'devin') return key;
  if (!/^devin#[1-9]\d*$/.test(key)) return null;
  const ordinal = Number(key.slice(6));
  return Number.isSafeInteger(ordinal) && ordinal >= 2 ? key : null;
}

export function parseCodeSearchConfig(value: unknown): CodeSearchConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== 'accountKey' && key !== 'revision')) return null;
  const accountKey = parseCodeSearchAccountKey(record.accountKey);
  if (record.accountKey !== null && (accountKey === null || accountKey !== record.accountKey))
    return null;
  if (
    typeof record.revision !== 'number' ||
    !Number.isSafeInteger(record.revision) ||
    record.revision < 0
  )
    return null;
  return { accountKey, revision: record.revision };
}
