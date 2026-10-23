import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import { parseChildSessionIdentity } from '@shared/builtinAgents';
import {
  type ChildConversationMetadata,
  type ChildHistoryResult,
  parseChildConversationMetadata,
  parseSafeJournalRecord,
} from '@shared/types/agent';
import { projectParentHistoryPage, projectParentHistoryTail } from './sessionHistoryTail';

export interface ChildHistoryDeps {
  sessionDir: string;
  persistedConversation: (conversationId: string) => Record<string, unknown> | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function within(root: string, file: string): boolean {
  return file.startsWith(`${root}${path.sep}`);
}

function unavailable(): ChildHistoryResult {
  // Never send parser exceptions, raw JSONL, or filesystem paths across IPC.
  return { ok: false, code: 'unavailable', error: 'Child history is unavailable or invalid.' };
}

/** Reject malformed tree entries before traversal (including cycles, duplicate IDs and orphans). */
function isSessionEntry(value: unknown): value is SessionEntry {
  const entry = record(value);
  if (
    !entry ||
    !nonEmpty(entry.id) ||
    typeof entry.timestamp !== 'string' ||
    (entry.parentId !== null && !nonEmpty(entry.parentId))
  )
    return false;
  switch (entry.type) {
    case 'message': {
      const message = record(entry.message);
      return (
        message !== null &&
        nonEmpty(message.role) &&
        (message.content === undefined ||
          message.content === null ||
          typeof message.content === 'string' ||
          Array.isArray(message.content))
      );
    }
    case 'compaction':
      return (
        typeof entry.summary === 'string' &&
        typeof entry.firstKeptEntryId === 'string' &&
        typeof entry.tokensBefore === 'number'
      );
    case 'branch_summary':
      return typeof entry.summary === 'string' && typeof entry.fromId === 'string';
    case 'custom_message':
      return (
        typeof entry.customType === 'string' &&
        typeof entry.display === 'boolean' &&
        (typeof entry.content === 'string' || Array.isArray(entry.content))
      );
    case 'custom':
      return typeof entry.customType === 'string';
    case 'model_change':
      return typeof entry.provider === 'string' && typeof entry.modelId === 'string';
    case 'thinking_level_change':
      return typeof entry.thinkingLevel === 'string';
    case 'usage':
      return typeof entry.kind === 'string' && record(entry.usage) !== null;
    case 'label':
      return typeof entry.targetId === 'string';
    case 'session_info':
      return entry.name === undefined || typeof entry.name === 'string';
    case 'context_edit':
      return (
        typeof entry.targetId === 'string' &&
        (entry.replacement === null || record(entry.replacement) !== null)
      );
    default:
      return false;
  }
}

/** Same last-entry leaf semantics as SessionManager.getBranch, without its disk repair/migration. */
function piBranch(header: Record<string, unknown>, entries: unknown[]): SessionEntry[] | null {
  if (
    header.type !== 'session' ||
    (header.version !== 2 && header.version !== 3) ||
    !nonEmpty(header.id) ||
    typeof header.cwd !== 'string' ||
    typeof header.timestamp !== 'string'
  ) {
    return null;
  }
  const byId = new Map<string, SessionEntry>();
  let leaf: SessionEntry | undefined;
  for (const entry of entries) {
    if (
      !isSessionEntry(entry) ||
      byId.has(entry.id) ||
      (entry.parentId !== null && !byId.has(entry.parentId))
    )
      return null;
    byId.set(entry.id, entry);
    leaf = entry;
  }
  const branch: SessionEntry[] = [];
  while (leaf) {
    branch.push(leaf);
    leaf = leaf.parentId === null ? undefined : byId.get(leaf.parentId);
  }
  return branch.reverse();
}

function safeHeaderMatches(
  header: Record<string, unknown>,
  id: string,
  metadata: ChildConversationMetadata
): boolean {
  const child = parseChildSessionIdentity(header.child);
  // A resumed child keeps the same journal header, but receives a new generation.
  return (
    header.type === 'enso-safe-session' &&
    header.version === 1 &&
    child !== null &&
    typeof header.cwd === 'string' &&
    typeof header.createdAt === 'number' &&
    Number.isFinite(header.createdAt) &&
    child.sessionId === id &&
    child.parent.sessionId === metadata.parentId &&
    child.instanceId === metadata.agentInstanceId &&
    child.instanceName === metadata.agentInstanceName &&
    child.typeKey === metadata.agentTypeKey &&
    child.profileId === metadata.lockedProfileId
  );
}

/** Read-only: no worker, SessionManager.open (which repairs/migrates files), or capability grants. */
export async function readChildHistory(
  conversationId: string,
  beforeIndex: number | undefined,
  deps: ChildHistoryDeps
): Promise<ChildHistoryResult> {
  if (beforeIndex !== undefined && (!Number.isSafeInteger(beforeIndex) || beforeIndex < 0)) {
    return unavailable();
  }
  try {
    const persisted = deps.persistedConversation(conversationId);
    if (!persisted) return { ok: false, code: 'not-found', error: 'No persisted child history.' };
    const metadata = parseChildConversationMetadata(persisted.child);
    if (
      !metadata ||
      (persisted.id !== undefined && persisted.id !== conversationId) ||
      persisted.parentId !== metadata.parentId ||
      conversationId !== `${metadata.parentId}::cw-${metadata.agentInstanceId}`
    )
      return unavailable();
    const parent = deps.persistedConversation(metadata.parentId);
    if (
      !parent ||
      (parent.id !== undefined && parent.id !== metadata.parentId) ||
      metadata.parentId === conversationId
    )
      return unavailable();
    const sessionFile = persisted.sessionFile;
    if (!nonEmpty(sessionFile))
      return { ok: false, code: 'not-found', error: 'No persisted child history.' };
    const root = path.resolve(deps.sessionDir);
    const resolved = path.resolve(sessionFile);
    const locked = metadata.agentTypeKey === 'agent:enso';
    if (
      !within(root, resolved) ||
      path.extname(resolved) !== '.jsonl' ||
      path.basename(resolved).startsWith('enso-') !== locked
    )
      return unavailable();
    const [actualRoot, actualFile] = await Promise.all([realpath(root), realpath(resolved)]);
    if (!within(actualRoot, actualFile) || !(await stat(actualFile)).isFile()) return unavailable();
    const parentSessionFile = parent.sessionFile;
    if (nonEmpty(parentSessionFile)) {
      // Do not expose the parent's transcript through a child record or symlink alias.
      const parentFile = await realpath(parentSessionFile).catch(() =>
        path.resolve(parentSessionFile)
      );
      if (parentFile === actualFile) return unavailable();
    }
    const lines = (await readFile(actualFile, 'utf8')).split('\n').filter((line) => line.trim());
    const values: unknown[] = lines.map((line) => JSON.parse(line));
    const header = record(values.shift());
    if (!header) return unavailable();
    if (locked) {
      if (!safeHeaderMatches(header, conversationId, metadata)) return unavailable();
      const records = values.map(parseSafeJournalRecord);
      if (records.some((entry) => entry === null)) return unavailable();
      return {
        ok: true,
        source: 'history',
        projection: {
          records: records.filter((entry) => entry !== null),
          partial: false,
        },
      };
    }
    const branch = piBranch(header, values);
    if (!branch) return unavailable();
    return {
      ok: true,
      source: 'tail',
      ...(beforeIndex === undefined
        ? projectParentHistoryTail(branch)
        : projectParentHistoryPage(branch, beforeIndex)),
    };
  } catch (error) {
    const code = record(error)?.code;
    return code === 'ENOENT'
      ? { ok: false, code: 'not-found', error: 'Child history file is missing.' }
      : unavailable();
  }
}
