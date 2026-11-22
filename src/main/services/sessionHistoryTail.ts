import path from 'node:path';
import { type SessionEntry, sessionEntryToContextMessages } from '@earendil-works/pi-coding-agent';
import { takeSnapshotTail } from '@shared/snapshotTail';
import type { ProjectedMemoryUpdate, ProjectedMessage } from '@shared/types/agent';
import { parseMemoryUpsertReceipt, withoutReviewEntries } from '../../agent/memoryTurnReview';
import { projectMessage } from '../../agent/projection';
import { withUserEntryIds } from '../../agent/transcript';

export function resolveParentHistoryFile(
  sessionDir: string,
  sessionFile: string | undefined
): string | null {
  if (!sessionFile) return null;
  const root = path.resolve(sessionDir);
  const resolved = path.resolve(sessionFile);
  const within = resolved === root || resolved.startsWith(`${root}${path.sep}`);
  return within ? resolved : null;
}

function projectWindow(
  raw: unknown[],
  endIndex: number
): {
  messages: ProjectedMessage[];
  baseIndex: number;
} {
  const end = Math.max(0, Math.min(endIndex, raw.length));
  if (end === 0) return { messages: [], baseIndex: 0 };
  const window = takeSnapshotTail(raw, end);
  return {
    messages: window.messages
      .map(projectMessage)
      .filter((message): message is ProjectedMessage => message !== null),
    baseIndex: window.baseIndex,
  };
}

/**
 * 每一轮真正落盘的 Wiki 写入（待审批/失败不算），按「该轮最后一条 assistant 的时间戳」归位。
 * 回答里自己写的、收尾轮补写的都算：只要这一轮 Wiki 变了，就挂在它的回答下。
 */
function memoryUpdatesByTurn(
  branch: readonly SessionEntry[]
): Array<{ updates: ProjectedMemoryUpdate[]; assistants: number[] }> {
  const turns: Array<{ updates: ProjectedMemoryUpdate[]; assistants: number[] }> = [];
  let pending: ProjectedMemoryUpdate[] = [];
  let assistants: number[] = [];
  const flush = () => {
    if (pending.length > 0) turns.push({ updates: pending, assistants });
    pending = [];
    assistants = [];
  };
  for (const entry of branch) {
    if (entry.type === 'custom_message' && entry.customType === 'codekiln.project-memory-review')
      continue;
    if (entry.type !== 'message') continue;
    const message = entry.message;
    if (message?.role === 'user') {
      flush();
      continue;
    }
    if (message?.role === 'assistant') {
      if (typeof message.timestamp === 'number') assistants.push(message.timestamp);
      continue;
    }
    if (message?.role !== 'toolResult' || message.toolName !== 'memory_upsert') continue;
    const text = (Array.isArray(message.content) ? message.content : [])
      .map((part) => (part && typeof part === 'object' && part.type === 'text' ? part.text : ''))
      .join('\n');
    const receipt = parseMemoryUpsertReceipt(text);
    if (
      receipt &&
      !pending.some((item) => item.spaceId === receipt.spaceId && item.relPath === receipt.relPath)
    )
      pending.push(receipt);
  }
  flush();
  return turns;
}

/**
 * 收尾轮（记忆整理）不是对话内容，历史与手机回放也不能显示它：指令和它之后的问答一起丢掉。
 * 必须在切窗之前按条目过滤，否则残留的指令会占掉一个下标，分页会错位。
 * 每轮真正写过的 Wiki 页挂到该轮回答上，重载后卡片仍然在。
 */
function visibleContextMessages(branch: readonly SessionEntry[]): unknown[] {
  const visible: unknown[] = withUserEntryIds(
    withoutReviewEntries(branch).flatMap(sessionEntryToContextMessages),
    branch
  );
  const turns = memoryUpdatesByTurn(branch);
  if (turns.length === 0) return visible;
  const visibleAssistants = new Set(
    visible
      .map((message) => message as { role?: unknown; timestamp?: unknown })
      .filter((message) => message.role === 'assistant' && typeof message.timestamp === 'number')
      .map((message) => message.timestamp as number)
  );
  // 一轮的最后一条 assistant 可能正是被隐藏的收尾回答，那就往前找最近的可见回答。
  const byAnswer = new Map<number, ProjectedMemoryUpdate[]>();
  for (const turn of turns) {
    const target = [...turn.assistants].reverse().find((at) => visibleAssistants.has(at));
    if (target !== undefined) byAnswer.set(target, turn.updates);
  }
  if (byAnswer.size === 0) return visible;
  return visible.map((message) => {
    const value = message as { role?: unknown; timestamp?: unknown };
    if (value.role !== 'assistant' || typeof value.timestamp !== 'number') return message;
    const updates = byAnswer.get(value.timestamp);
    return updates ? { ...(message as Record<string, unknown>), memoryUpdates: updates } : message;
  });
}

export function projectParentHistoryPage(
  branch: readonly SessionEntry[],
  beforeIndex: number
): {
  messages: ProjectedMessage[];
  baseIndex: number;
} {
  return projectWindow(visibleContextMessages(branch), beforeIndex);
}

export function projectParentHistoryTail(branch: readonly SessionEntry[]): {
  messages: ProjectedMessage[];
  baseIndex: number;
} {
  const raw = visibleContextMessages(branch);
  return projectWindow(raw, raw.length);
}

/** 全量投影：worker 无投影的会话合成快照用（分页由快照链路按绝对 index 切） */
export function projectParentHistoryAll(branch: readonly SessionEntry[]): ProjectedMessage[] {
  return visibleContextMessages(branch)
    .map(projectMessage)
    .filter((message): message is ProjectedMessage => message !== null);
}
