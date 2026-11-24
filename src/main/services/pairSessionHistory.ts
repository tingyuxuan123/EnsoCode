import { statSync } from 'node:fs';
import type { ProjectedMessage } from '@shared/types/agent';
import { projectParentHistoryAll, resolveParentHistoryFile } from './sessionHistoryTail';

const CACHE_LIMIT = 16;
const cache = new Map<string, { stamp: string; messages: readonly ProjectedMessage[] }>();

/** Cached full transcript projection for authorized phone file, image and preview lookups. */
export async function readPairSessionMessages(
  sessionDir: string,
  sessionFile: string | undefined
): Promise<readonly ProjectedMessage[]> {
  const resolved = resolveParentHistoryFile(sessionDir, sessionFile);
  if (!resolved) throw new Error('session file outside sessions directory');
  const stat = statSync(resolved);
  const stamp = `${stat.mtimeMs}:${stat.size}`;
  const hit = cache.get(resolved);
  if (hit?.stamp === stamp) {
    cache.delete(resolved);
    cache.set(resolved, hit);
    return hit.messages;
  }
  const { SessionManager } = await import('@earendil-works/pi-coding-agent');
  const messages = projectParentHistoryAll(SessionManager.open(resolved, sessionDir).getBranch());
  cache.delete(resolved);
  cache.set(resolved, { stamp, messages });
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  return messages;
}
