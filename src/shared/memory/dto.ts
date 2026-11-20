import {
  isNoteStatus,
  isUpsertMode,
  isVaultPreset,
  type NoteStatus,
  type UpsertMode,
  type VaultPreset,
} from './constants';

export type VaultSpaceKind = 'global' | 'project' | 'bot' | 'chat';

export interface VaultSpaceDto {
  spaceId: string;
  label: string;
  kind: VaultSpaceKind;
  rootPath: string;
  isExternal: boolean;
  preset: VaultPreset;
  noteCount: number;
  brokenLinks: number;
  staleCount: number;
  draftCount: number;
  indexFilename: string;
}

export interface MemoryNoteSummary {
  /** Canonical opaque id: `${spaceId}::${relPath}` */
  id: string;
  spaceId: string;
  spaceLabel: string;
  relPath: string;
  slug: string;
  title: string;
  description: string;
  type: string;
  status: NoteStatus;
  tags: string[];
  isRaw: boolean;
  isArchived: boolean;
  generatedBy: string | null;
  generatedAt: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  staleAfter: string | null;
  outboundCount: number;
  inboundCount: number;
  lineCount: number;
  updatedAt: string;
}

export interface NoteLinkDto {
  raw: string;
  target: string;
  resolvedNoteId: string | null;
  resolvedTitle: string | null;
  isBroken: boolean;
}

export interface NoteBacklinkDto {
  noteId: string;
  slug: string;
  title: string;
  type: string;
}

export interface MemoryNoteDetail extends MemoryNoteSummary {
  body: string;
  rawMarkdown: string;
  resource: string | null;
  sources: string[];
  supersededBy: string | null;
  links: NoteLinkDto[];
  backlinks: NoteBacklinkDto[];
}

export interface MemoryListQuery {
  spaceId?: string | null;
  query?: string;
  type?: string;
  status?: NoteStatus;
  includeArchived?: boolean;
  includeRaw?: boolean;
  limit: number;
  offset: number;
}

export interface MemoryListResult {
  items: MemoryNoteSummary[];
  total: number;
  types: string[];
}

export type VaultDocKind = 'index' | 'log' | 'schema';

export interface VaultDocDto {
  spaceId: string;
  kind: VaultDocKind;
  filename: string;
  content: string;
  updatedAt: string | null;
}

export function isVaultDocKind(value: unknown): value is VaultDocKind {
  return value === 'index' || value === 'log' || value === 'schema';
}

export interface MemoryEditPatch {
  title?: string;
  description?: string;
  type?: string;
  status?: NoteStatus;
  tags?: string[];
  staleAfter?: string | null;
  body?: string;
  /** Optimistic concurrency guard matching MemoryNoteDetail.updatedAt on disk. */
  expectedUpdatedAt?: string | null;
}

export interface MemoryCreateInput {
  spaceId: string;
  slug?: string;
  title: string;
  type: string;
  description?: string;
  tags?: string[];
  body: string;
}

export interface MemoryMutationResult {
  ok: boolean;
  note?: MemoryNoteDetail;
  conflict?: boolean;
  currentNote?: MemoryNoteDetail;
  error?: string;
}

export interface MemoryVaultActionResult {
  ok: boolean;
  space?: VaultSpaceDto;
  cancelled?: boolean;
  error?: string;
}

export type MemoryLintIssueKind =
  | 'broken_link'
  | 'orphan'
  | 'stale'
  | 'unverified_draft'
  | 'missing_description'
  | 'oversized';

export interface MemoryLintIssue {
  kind: MemoryLintIssueKind;
  spaceId: string;
  spaceLabel: string;
  noteId: string;
  slug: string;
  title: string;
  detail: string;
}

export interface MemoryLintReport {
  issues: MemoryLintIssue[];
  checkedNotes: number;
  checkedAt: string;
}

export interface CompileJobDto {
  id: number;
  sessionId: string;
  sessionTitle?: string | null;
  projectId: string | null;
  projectName?: string | null;
  status: 'pending' | 'running' | 'done' | 'cancelled';
  attempts: number;
  written: number;
  error: string | null;
  notes: {
    kind: 'created' | 'updated' | 'pending_review' | 'skipped' | 'rejected';
    slug: string | null;
    title: string | null;
    detail: string;
  }[];
  createdAt: string;
  updatedAt: string;
}

export interface MemoryJobsSnapshot {
  compile: CompileJobDto[];
}

export interface MemoryStats {
  totalNotes: number;
  totalLinks: number;
  brokenLinks: number;
  draftCount: number;
  verifiedCount: number;
  staleCount: number;
  archivedCount: number;
  indexBytes: number;
  spaces: VaultSpaceDto[];
}

export type PendingMemoryWriteKind = 'agent' | 'compile';
export type PendingMemoryWriteDecision = 'approve' | 'reject';

export interface PendingMemoryWriteDto {
  id: string;
  kind: PendingMemoryWriteKind;
  spaceId: string;
  spaceLabel: string;
  botId: string | null;
  chatId: string | null;
  targetRelPath: string;
  slug: string;
  title: string;
  type: string;
  description: string | null;
  mode: UpsertMode;
  section: string | null;
  existingBody: string | null;
  proposedBody: string;
  redacted: boolean;
  createdAt: string;
}

export interface CompilableSessionDto {
  sessionId: string;
  title: string;
  projectId: string | null;
  projectName: string | null;
  messageCount: number;
  compiled: boolean;
  updatedAt: string;
}

export interface ChatModelDto {
  id: string;
  label: string;
  params: string;
  contextSize: number;
  approxBytes: number;
  downloadedBytes: number;
  downloadable: boolean;
  state: 'ready' | 'missing' | 'downloading';
  purpose?: 'voice-correction';
}

export interface EmbeddingDownloadProgressDto {
  modelId: string;
  file: string;
  fileIndex: number;
  fileCount: number;
  received: number;
  total: number | null;
  done?: true;
  error?: string;
}

export type ChatModelDownloadProgressDto = EmbeddingDownloadProgressDto;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function isMemoryListQuery(value: unknown): value is MemoryListQuery {
  if (!isRecord(value)) return false;
  if (
    !Number.isSafeInteger(value.limit) ||
    (value.limit as number) < 1 ||
    (value.limit as number) > 500
  ) {
    return false;
  }
  if (!Number.isSafeInteger(value.offset) || (value.offset as number) < 0) return false;
  if (value.spaceId !== undefined && value.spaceId !== null && typeof value.spaceId !== 'string') {
    return false;
  }
  if (value.query !== undefined && typeof value.query !== 'string') return false;
  if (value.type !== undefined && typeof value.type !== 'string') return false;
  if (value.status !== undefined && !isNoteStatus(value.status)) return false;
  if (value.includeArchived !== undefined && typeof value.includeArchived !== 'boolean') {
    return false;
  }
  if (value.includeRaw !== undefined && typeof value.includeRaw !== 'boolean') return false;
  return true;
}

export function isMemoryEditPatch(value: unknown): value is MemoryEditPatch {
  if (!isRecord(value)) return false;
  if (value.title !== undefined && typeof value.title !== 'string') return false;
  if (value.description !== undefined && typeof value.description !== 'string') return false;
  if (value.type !== undefined && typeof value.type !== 'string') return false;
  if (value.status !== undefined && !isNoteStatus(value.status)) return false;
  if (
    value.tags !== undefined &&
    (!Array.isArray(value.tags) || value.tags.some((t) => typeof t !== 'string'))
  ) {
    return false;
  }
  if (
    value.staleAfter !== undefined &&
    value.staleAfter !== null &&
    typeof value.staleAfter !== 'string'
  ) {
    return false;
  }
  if (
    value.expectedUpdatedAt !== undefined &&
    value.expectedUpdatedAt !== null &&
    typeof value.expectedUpdatedAt !== 'string'
  ) {
    return false;
  }
  if (value.body !== undefined && typeof value.body !== 'string') return false;
  return (
    value.title !== undefined ||
    value.description !== undefined ||
    value.type !== undefined ||
    value.status !== undefined ||
    value.tags !== undefined ||
    value.staleAfter !== undefined ||
    value.body !== undefined
  );
}

export function isMemoryCreateInput(value: unknown): value is MemoryCreateInput {
  if (!isRecord(value)) return false;
  if (typeof value.spaceId !== 'string' || !value.spaceId.trim()) return false;
  if (typeof value.title !== 'string' || !value.title.trim()) return false;
  if (typeof value.type !== 'string' || !value.type.trim()) return false;
  if (typeof value.body !== 'string') return false;
  if (value.slug !== undefined && typeof value.slug !== 'string') return false;
  if (value.description !== undefined && typeof value.description !== 'string') return false;
  if (
    value.tags !== undefined &&
    (!Array.isArray(value.tags) || value.tags.some((t) => typeof t !== 'string'))
  ) {
    return false;
  }
  return true;
}

export function isPendingMemoryWriteDecision(value: unknown): value is PendingMemoryWriteDecision {
  return value === 'approve' || value === 'reject';
}

export function isValidVaultPreset(value: unknown): value is VaultPreset {
  return isVaultPreset(value);
}

export function isValidUpsertMode(value: unknown): value is UpsertMode {
  return isUpsertMode(value);
}
