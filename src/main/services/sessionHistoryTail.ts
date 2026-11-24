import path from 'node:path';
import { type SessionEntry, sessionEntryToContextMessages } from '@earendil-works/pi-coding-agent';
import { takeSnapshotTail } from '@shared/snapshotTail';
import type { ProjectedMessage } from '@shared/types/agent';
import { legacyMemoryReviewEntries } from '../../agent/legacyMemoryReviewHistory';
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

/** Filter retired internal closeouts before windowing to preserve visible page indices. */
function visibleContextMessages(branch: readonly SessionEntry[]): unknown[] {
  const hiddenReviews = legacyMemoryReviewEntries(branch);
  return withUserEntryIds(
    branch.flatMap((entry) =>
      hiddenReviews.has(entry) ? [] : sessionEntryToContextMessages(entry)
    ),
    branch
  );
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
