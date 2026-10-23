import type { AgentRunProgress, AgentRunStatus } from '@shared/types/agent';
import { canSelectCoworkerTab } from '@/stores/sessions/coworkerTabPolicy';

export interface SubagentTarget {
  parentConversationId: string;
  childConversationId: string;
  title: string;
}

export interface SubagentDirectoryEntry {
  childConversationId: string;
  agentId: string;
  title: string;
  mode: 'task' | 'coworker';
  origin: 'manual' | 'agent-tool' | 'typed-mention';
  /** Instance lifecycle, independent of the latest Run outcome. */
  closed: boolean;
  canOpenConversation: boolean;
  status: 'starting' | 'waiting' | 'ended' | AgentRunStatus;
  modelId?: string;
  createdAt: number;
  ended: boolean;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function entryFor(
  id: string,
  value: unknown,
  parentId: string,
  parent?: Record<string, unknown>
): SubagentDirectoryEntry | null {
  const conversation = record(value);
  const child = record(conversation?.child);
  if (
    !id ||
    id === parentId ||
    !conversation ||
    !child ||
    conversation.parentId !== parentId ||
    child.parentId !== parentId ||
    typeof child.agentInstanceId !== 'string' ||
    !child.agentInstanceId.trim() ||
    typeof child.agentInstanceName !== 'string' ||
    !child.agentInstanceName.trim() ||
    typeof child.dispatchOrigin !== 'string' ||
    !['agent-tool', 'typed-mention', 'manual'].includes(child.dispatchOrigin) ||
    (child.mode !== undefined && child.mode !== 'task' && child.mode !== 'coworker')
  )
    return null;
  const closed = conversation.ended === true || conversation.historyOnly === true;
  const spawning = !closed && conversation.spawning === true;
  const running = !closed && conversation.status === 'running';
  const lastRun = record(conversation.lastSubagentRun);
  const lastStatus = lastRun?.status;
  const runStatus =
    typeof lastStatus === 'string' &&
    [
      'queued',
      'running',
      'awaiting_input',
      'validating',
      'succeeded',
      'failed',
      'cancelled',
      'interrupted',
    ].includes(lastStatus)
      ? (lastStatus as AgentRunStatus)
      : undefined;
  const failed = conversation.status === 'failed' || Boolean(conversation.error);
  const ended = closed || (!running && !spawning && (Boolean(runStatus) || failed));
  const status = spawning
    ? 'starting'
    : running
      ? 'running'
      : (runStatus ?? (failed ? 'failed' : closed ? 'ended' : 'waiting'));
  return {
    childConversationId: id,
    agentId: child.agentInstanceId,
    title: child.agentInstanceName,
    mode: child.mode === 'task' ? 'task' : 'coworker',
    origin: child.dispatchOrigin as SubagentDirectoryEntry['origin'],
    closed,
    canOpenConversation:
      !closed && canSelectCoworkerTab({ [parentId]: parent, [id]: conversation }, parentId, id),
    status,
    ...(typeof conversation.lastModelId === 'string' ? { modelId: conversation.lastModelId } : {}),
    createdAt:
      typeof conversation.createdAt === 'number' && Number.isFinite(conversation.createdAt)
        ? conversation.createdAt
        : 0,
    ended,
  };
}

/** Authority comes only from child metadata, never run IDs, names or ID string conventions. */
export function resolveSubagentTarget(
  conversations: Record<string, unknown>,
  parentId: string,
  agentId: string
): SubagentTarget | null {
  if (!parentId || !agentId || !record(conversations[parentId])) return null;
  let match: SubagentDirectoryEntry | undefined;
  for (const [id, value] of Object.entries(conversations)) {
    const entry = entryFor(id, value, parentId);
    if (!entry || entry.agentId !== agentId) continue;
    if (match) return null;
    match = entry;
  }
  return match
    ? {
        parentConversationId: parentId,
        childConversationId: match.childConversationId,
        title: match.title,
      }
    : null;
}

const directoryCache = new Map<string, SubagentDirectoryEntry[]>();
const EMPTY_DIRECTORY: SubagentDirectoryEntry[] = [];

/** Stable metadata projection: streaming body changes do not rerender the directory. Not a Run ledger. */
export function selectSubagentDirectory(
  conversations: Record<string, unknown>,
  parentId: string,
  runs: readonly AgentRunProgress[] = []
): SubagentDirectoryEntry[] {
  if (!record(conversations[parentId])) {
    directoryCache.delete(parentId);
    return EMPTY_DIRECTORY;
  }
  const entries = Object.entries(conversations)
    .flatMap(([id, value]) => {
      const entry = entryFor(id, value, parentId, record(conversations[parentId]));
      if (!entry) return [];
      const current =
        runs.find((run) => run.agentId === entry.agentId && run.status !== 'queued') ??
        runs.find((run) => run.agentId === entry.agentId);
      // 校验仍是运行态，不可提前采用上一 Run 的成功结论。
      if (
        current &&
        !entry.closed &&
        ['queued', 'running', 'awaiting_input', 'validating'].includes(current.status)
      ) {
        return [{ ...entry, status: current.status, ended: false }];
      }
      return [entry];
    })
    .sort(
      (a, b) =>
        a.createdAt - b.createdAt || a.childConversationId.localeCompare(b.childConversationId)
    );
  const previous = directoryCache.get(parentId);
  if (
    previous &&
    previous.length === entries.length &&
    entries.every((entry, i) => {
      const old = previous[i];
      return (
        entry.childConversationId === old.childConversationId &&
        entry.agentId === old.agentId &&
        entry.title === old.title &&
        entry.mode === old.mode &&
        entry.origin === old.origin &&
        entry.closed === old.closed &&
        entry.canOpenConversation === old.canOpenConversation &&
        entry.status === old.status &&
        entry.modelId === old.modelId &&
        entry.createdAt === old.createdAt &&
        entry.ended === old.ended
      );
    })
  )
    return previous;
  directoryCache.set(parentId, entries);
  return entries;
}
