export const NOTE_STATUSES = ['draft', 'verified', 'deprecated'] as const;
export type NoteStatus = (typeof NOTE_STATUSES)[number];

export function isNoteStatus(value: unknown): value is NoteStatus {
  return typeof value === 'string' && (NOTE_STATUSES as readonly string[]).includes(value);
}

export const DEFAULT_NOTE_STATUS: NoteStatus = 'draft';
export const DEFAULT_NOTE_TYPE = 'note';

/**
 * 状态页：每个空间只有一篇，描述“现在进行到哪”，与 evergreen 知识页分开。
 * 固定路径让“唯一”成为结构约束，而不是靠校验去堵。
 */
export const STATUS_NOTE_TYPE = 'status';
export const STATUS_NOTE_SLUG = 'status';
export const STATUS_NOTE_REL_PATH = 'wiki/status.md';

export const VAULT_PRESETS = ['engineering', 'personal', 'minimal'] as const;
export type VaultPreset = (typeof VAULT_PRESETS)[number];

export function isVaultPreset(value: unknown): value is VaultPreset {
  return typeof value === 'string' && (VAULT_PRESETS as readonly string[]).includes(value);
}

export const UPSERT_MODES = ['replace', 'append', 'section'] as const;
export type UpsertMode = (typeof UPSERT_MODES)[number];

export function isUpsertMode(value: unknown): value is UpsertMode {
  return typeof value === 'string' && (UPSERT_MODES as readonly string[]).includes(value);
}

export const MEMORY_LANGUAGES = ['en', 'zh', 'auto'] as const;
export type MemoryLanguage = (typeof MEMORY_LANGUAGES)[number];

export const DEFAULT_MEMORY_DISTILL_ENABLED = true;
export const DEFAULT_MEMORY_LANGUAGE: MemoryLanguage = 'zh';

export function isMemoryLanguage(value: unknown): value is MemoryLanguage {
  return typeof value === 'string' && (MEMORY_LANGUAGES as readonly string[]).includes(value);
}

export function resolveMemoryLanguage(value: unknown): MemoryLanguage {
  return isMemoryLanguage(value) ? value : DEFAULT_MEMORY_LANGUAGE;
}

export const MANAGED_INDEX_MARKER = '<!-- collabra:managed -->';
export const DEFAULT_INDEX_FILENAME = 'index.md';
export const FALLBACK_INDEX_FILENAME = '_collabra-index.md';
export const LOG_FILENAME = 'log.md';
export const SCHEMA_FILENAME = 'schema.md';

export const DEFAULT_SEARCH_LIMIT = 8;
export const MAX_SEARCH_LIMIT = 30;
export const DEFAULT_INDEX_LIMIT = 80;
export const MAX_INDEX_LIMIT = 300;

export const LINT_OVERSIZED_LINES = 300;
export const LINT_STALE_DRAFT_DAYS = 14;
/** 状态页一屏预算（非空行）与“太久没更新”的天数 */
export const LINT_STATUS_MAX_LINES = 60;
export const LINT_STATUS_STALE_DAYS = 30;

/**
 * 核验通过后写进 `verified.by` 的身份：与写入者（collabra-compiler / collabra-agent）区分开，
 * 这样“谁说的”和“谁核对的”在 frontmatter 里都可查。
 */
export const MEMORY_VERIFIER_ACTOR = 'collabra-verifier';
export const VERIFY_MAX_NOTE_CHARS = 4000;

export const COMPILE_MAX_CHUNK_CHARS = 6000;
export const COMPILE_MAX_ACTIONS = 3;
export const COMPILE_MAX_ATTEMPTS = 3;
export const COMPILE_MAX_OUTPUT_TOKENS = 4096;
