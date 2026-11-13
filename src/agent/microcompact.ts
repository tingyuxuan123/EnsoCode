import type { ContextEditEntryDraft, InlineExtension } from '@earendil-works/pi-coding-agent';
import { ARTIFACT_URI_SCHEME } from './toolOutputBudget';

export const MICROCOMPACT_PLACEHOLDER =
  '[Old read/search result cleared to save context. Read or search the source again if needed.]';
export const MICROCOMPACT_TOTAL_CHARS = 500_000;
export const MICROCOMPACT_LOW_WATERMARK = 250_000;
export const MICROCOMPACT_KEEP_RECENT = 5;
export const MICROCOMPACT_IDLE_MS = 60 * 60_000;

export interface MicrocompactOptions {
  /** 共享活配置；关闭不撤销已持久化编辑。 */
  enabled?: boolean;
  now?: () => number;
}

const COMPACTABLE_TOOLS = new Set(['read', 'grep', 'find', 'ls', 'web_fetch', 'web_search']);

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

function cleared(content: unknown): boolean {
  return (
    Array.isArray(content) &&
    content.length === 1 &&
    record(content[0])?.type === 'text' &&
    record(content[0])?.text === MICROCOMPACT_PLACEHOLDER
  );
}

/** 不猜测未知消息形状；图片、外置引用与错误结果永不替换。 */
function candidate(value: unknown): { id: string; chars: number; texts: string[] } | undefined {
  const message = record(value);
  if (
    message?.role !== 'toolResult' ||
    typeof message.toolCallId !== 'string' ||
    !message.toolCallId ||
    message.isError === true ||
    typeof message.toolName !== 'string' ||
    !COMPACTABLE_TOOLS.has(message.toolName) ||
    record(message.details)?.externalized === true ||
    !Array.isArray(message.content) ||
    message.content.length === 0
  )
    return;
  const texts: string[] = [];
  for (const raw of message.content) {
    const part = record(raw);
    if (part?.type !== 'text' || typeof part.text !== 'string') return;
    texts.push(part.text);
  }
  const chars = texts.reduce((sum, text) => sum + text.length, 0);
  if (
    chars <= MICROCOMPACT_PLACEHOLDER.length ||
    texts.join('').toLowerCase().includes(ARTIFACT_URI_SCHEME)
  )
    return;
  return { id: message.toolCallId, chars, texts };
}

function uniqueResultIds(messages: readonly unknown[]): Set<string> {
  const counts = new Map<string, number>();
  for (const raw of messages) {
    const message = record(raw);
    if (message?.role !== 'toolResult' || typeof message.toolCallId !== 'string') continue;
    counts.set(message.toolCallId, (counts.get(message.toolCallId) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, count]) => count === 1).map(([id]) => id));
}

export function selectMicrocompactTargets(
  messages: readonly unknown[],
  now: number,
  selected: ReadonlySet<string>
): string[] {
  const unique = uniqueResultIds(messages);
  const candidates: Array<{ id: string; chars: number }> = [];
  let lastReplyAt: number | undefined;
  for (const raw of messages) {
    const message = record(raw);
    if (
      message?.role === 'assistant' &&
      typeof message.timestamp === 'number' &&
      Number.isFinite(message.timestamp)
    )
      lastReplyAt = message.timestamp;
    const item = candidate(raw);
    if (item && unique.has(item.id) && !selected.has(item.id)) candidates.push(item);
  }
  const clearable = candidates.slice(0, Math.max(0, candidates.length - MICROCOMPACT_KEEP_RECENT));
  if (lastReplyAt !== undefined && now - lastReplyAt >= MICROCOMPACT_IDLE_MS)
    return clearable.map(({ id }) => id);
  let total = candidates.reduce((sum, item) => sum + item.chars, 0);
  if (total <= MICROCOMPACT_TOTAL_CHARS) return [];
  const targets: string[] = [];
  for (const item of clearable) {
    if (total <= MICROCOMPACT_LOW_WATERMARK) break;
    targets.push(item.id);
    total -= item.chars - MICROCOMPACT_PLACEHOLDER.length;
  }
  return targets;
}

export function applyMicrocompact<T>(messages: T[], selected: ReadonlySet<string>): T[] {
  if (selected.size === 0) return messages;
  const unique = uniqueResultIds(messages);
  let changed = false;
  const out = messages.map((message) => {
    const item = candidate(message);
    if (!item || !unique.has(item.id) || !selected.has(item.id)) return message;
    changed = true;
    return {
      ...message,
      content: [{ type: 'text', text: MICROCOMPACT_PLACEHOLDER }],
    };
  });
  return changed ? out : messages;
}

/** 统计持久化的最终替换，不把预览、重复编辑或后来撤销的替换算作收益。 */
export function collectMicrocompactStats(branch: readonly unknown[]): {
  results: number;
  charsRemoved: number;
} {
  const effective = new Map<string, unknown>();
  const reductions = new Map<string, number>();
  const duplicate = new Set<string>();
  let compactionIndex = -1;
  for (let i = 0; i < branch.length; i++)
    if (record(branch[i])?.type === 'compaction') compactionIndex = i;
  const firstKept = record(branch[compactionIndex])?.firstKeptEntryId;
  const keptIndex =
    typeof firstKept === 'string'
      ? branch.findIndex((raw, i) => i < compactionIndex && record(raw)?.id === firstKept)
      : -1;
  const activeIds = new Set(
    branch.flatMap((raw, i) => {
      const entry = record(raw);
      return entry?.type === 'message' &&
        typeof entry.id === 'string' &&
        (compactionIndex < 0 || i > compactionIndex || (keptIndex >= 0 && i >= keptIndex))
        ? [entry.id]
        : [];
    })
  );
  for (const raw of branch) {
    const entry = record(raw);
    if (entry?.type === 'message' && typeof entry.id === 'string') {
      if (effective.has(entry.id)) duplicate.add(entry.id);
      effective.set(entry.id, entry.message);
    }
    if (entry?.type !== 'context_edit' || typeof entry.targetId !== 'string') continue;
    const previous = record(effective.get(entry.targetId));
    if (!previous) continue;
    const content = record(entry.replacement)?.content;
    if (cleared(content)) {
      // 重复占位编辑幂等；首次只记相对于编辑前有效正文的差值。
      const item = candidate(previous);
      if (item) reductions.set(entry.targetId, item.chars - MICROCOMPACT_PLACEHOLDER.length);
    } else reductions.delete(entry.targetId);
    effective.set(entry.targetId, entry.replacement === null ? null : { ...previous, content });
  }
  let results = 0;
  let charsRemoved = 0;
  for (const [id, removed] of reductions) {
    if (duplicate.has(id) || !activeIds.has(id)) continue;
    results++;
    charsRemoved += removed;
  }
  return { results, charsRemoved };
}

export function microcompactExtension(options: MicrocompactOptions = {}): InlineExtension {
  return {
    name: 'microcompact',
    hidden: true,
    factory: (pi) => {
      const pending = new Map<string, { sourceId: string; signature: string }>();
      const signature = (raw: unknown) => {
        const message = record(raw);
        const item = candidate(raw);
        return item
          ? JSON.stringify([item.id, message?.toolName, message?.timestamp, item.texts])
          : undefined;
      };
      pi.on('agent_start', () => pending.clear());
      pi.on('session_tree', () => pending.clear());
      pi.on('context', (event, ctx) => {
        pending.clear();
        if (options.enabled === false || ctx.signal?.aborted) return;
        const selected = new Set(
          selectMicrocompactTargets(event.messages, (options.now ?? Date.now)(), new Set())
        );
        if (selected.size === 0) return;
        // 只接受可映射到权威源条目的结果；前序扩展合成/替换同名结果不能冒充原文。
        const entries = ctx.sessionManager.buildSessionProjection().entries;
        const unique = uniqueResultIds(entries.flatMap((entry) => entry.messages));
        const sources = new Map<string, { sourceId: string; signature: string }>();
        for (const entry of entries) {
          if (
            entry.sourceEntry.type !== 'message' ||
            entry.messages.length !== 1 ||
            !candidate(entry.sourceEntry.message)
          )
            continue;
          const item = candidate(entry.messages[0]);
          const stamp = signature(entry.messages[0]);
          if (item && stamp && unique.has(item.id))
            sources.set(item.id, { sourceId: entry.sourceEntry.id, signature: stamp });
        }
        for (const raw of event.messages) {
          const item = candidate(raw);
          const source = item && sources.get(item.id);
          if (item && source && selected.has(item.id) && source.signature === signature(raw))
            pending.set(item.id, source);
        }
        return { messages: applyMicrocompact(event.messages, new Set(pending.keys())) };
      });
      pi.on('turn_end', (event, ctx) => {
        const requested = new Map(pending);
        pending.clear();
        if (
          options.enabled === false ||
          event.outcome !== 'completed' ||
          ctx.signal?.aborted ||
          requested.size === 0
        )
          return;
        const entries = event.context.contextEntries;
        const unique = uniqueResultIds(entries.flatMap((entry) => entry.messages));
        const edits: ContextEditEntryDraft[] = [];
        for (const entry of entries) {
          if (entry.sourceEntry.type !== 'message' || entry.messages.length !== 1) continue;
          const item = candidate(entry.messages[0]);
          if (!item || !unique.has(item.id)) continue;
          const source = requested.get(item.id);
          if (
            !source ||
            source.sourceId !== entry.sourceEntry.id ||
            source.signature !== signature(entry.messages[0]) ||
            !candidate(entry.sourceEntry.message)
          )
            continue;
          edits.push({
            type: 'context_edit',
            targetId: entry.sourceEntry.id,
            replacement: { content: [{ type: 'text', text: MICROCOMPACT_PLACEHOLDER }] },
          });
        }
        if (edits.length > 0) return { entries: [...event.entries, ...edits] };
      });
    },
  };
}
