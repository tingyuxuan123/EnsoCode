import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import {
  type ProjectedMemoryDiff,
  type ProjectedMemoryUpdate,
  parseProjectedMemoryUpdates,
} from '@shared/types/agent';

export const MEMORY_REVIEW_MESSAGE = 'codekiln.project-memory-review';
const NO_CHANGE = ['本轮无新增项目记忆。', 'No new project memory.'];
const MAX_REVIEW_REQUESTS = 6;
const REVIEW_PROMPT = `One-time closeout of the answer immediately above, not a new user task. The answer is already visible; do not repeat it or resume implementation. Review this turn for durable project knowledge: confirmed decisions, API contracts, reproducible findings or changed project status. Respect requests not to save. Use only direct memory_index, memory_search, memory_read and memory_upsert, with spaceId="project". Search for existing pages first; read one before rewriting it. Never store secrets, transient chatter or speculation. If a change is needed, write it NOW and wait for the tool receipt. Report the returned page, not a promise. If no change is needed (including when the wiki already covers it), answer exactly "本轮无新增项目记忆。" or "No new project memory." in the conversation language. If access or writing fails, say so instead of declaring no change. This instruction expires with this turn.`;
const REVIEW_TOOLS = new Set(['memory_index', 'memory_search', 'memory_read', 'memory_upsert']);

type BranchEntry = {
  type: string;
  customType?: string;
  message?: { role?: string; timestamp?: number };
};

const messageKey = (role: string, timestamp: number | undefined): string =>
  `${role}:${timestamp ?? ''}`;

/**
 * 收尾轮不是对话内容：从「收尾指令」之后到下一个用户消息之前产生的消息都不该进时间线。
 * 挂在 transcript 上而不是内存标记，重载会话后同样成立。
 */
export function reviewHiddenKeys(branch: readonly BranchEntry[]): Set<string> {
  const keys = new Set<string>();
  let inside = false;
  for (const entry of branch) {
    if (entry.type === 'custom_message' && entry.customType === MEMORY_REVIEW_MESSAGE) {
      inside = true;
      continue;
    }
    if (!inside || entry.type !== 'message' || !entry.message?.role) continue;
    if (entry.message.role === 'user') {
      inside = false;
      continue;
    }
    keys.add(messageKey(entry.message.role, entry.message.timestamp));
  }
  return keys;
}

/**
 * 历史投影要按条目过滤：收尾指令本身也会作为一条 custom 消息进入上下文，
 * 只删收尾文字会留下错位的下标。
 */
export function withoutReviewEntries<T extends BranchEntry>(branch: readonly T[]): T[] {
  const out: T[] = [];
  let inside = false;
  for (const entry of branch) {
    if (entry.type === 'custom_message' && entry.customType === MEMORY_REVIEW_MESSAGE) {
      inside = true;
      continue;
    }
    if (inside) {
      if (entry.type !== 'message') continue;
      if (entry.message?.role === 'user') inside = false;
      else continue;
    }
    out.push(entry);
  }
  return out;
}

/** 实时阶段（收尾轮还没落成 transcript 之前）用同一口径判定。 */
export function isReviewHiddenMessage(
  reviewing: boolean,
  message: { role: string; timestamp?: number }
): boolean {
  return reviewing && message.role !== 'user';
}

export { messageKey };

function parseDiff(value: unknown): ProjectedMemoryDiff | undefined {
  const [wrapped] = parseProjectedMemoryUpdates([
    { spaceId: 'probe', relPath: 'probe', status: 'updated', ...(value ? { diff: value } : {}) },
  ]) ?? [undefined as never];
  return wrapped?.diff;
}

/** 记忆写入回执 → 折叠卡片的一行；非写入/待审批/损坏一律不认。 */
export function parseMemoryUpsertReceipt(value: unknown): ProjectedMemoryUpdate | null {
  let parsed: Record<string, unknown> | null = null;
  if (value && typeof value === 'object' && !Array.isArray(value))
    parsed = value as Record<string, unknown>;
  else if (typeof value === 'string') {
    try {
      const json = JSON.parse(value.slice(value.indexOf('{')));
      if (json && typeof json === 'object') parsed = json as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  if (parsed?.written !== true) return null;
  if (parsed.status !== 'created' && parsed.status !== 'updated') return null;
  if (typeof parsed.relPath !== 'string' || !parsed.relPath.trim()) return null;
  if (typeof parsed.spaceId !== 'string' || !parsed.spaceId.trim()) return null;
  const diff = parseDiff(parsed.diff);
  return {
    spaceId: parsed.spaceId,
    relPath: parsed.relPath,
    ...(typeof parsed.title === 'string' && parsed.title.trim() ? { title: parsed.title } : {}),
    status: parsed.status,
    ...(diff ? { diff } : {}),
  };
}

/** The SDK awaits this boundary before publishing agent_settled. Never enqueue a separate prompt. */
export function memoryTurnReviewExtension(
  enabled: () => boolean,
  lifecycle: { start?: () => void; reset?: () => void; fail?: (reason: string) => void } = {}
): Extract<InlineExtension, { factory: unknown }> {
  return {
    name: 'project-memory-turn-review',
    hidden: true,
    factory(pi) {
      let reviewing = false;
      let written = false;
      let writeFailed = false;
      const failedReads = new Set<string>();
      let requests = 0;
      const reset = () => {
        reviewing = false;
        written = false;
        writeFailed = false;
        failedReads.clear();
        requests = 0;
        lifecycle.reset?.();
      };
      // agent_start also fires for SDK continuations; it is NOT the user-turn boundary.
      pi.on('before_agent_start', reset);
      pi.on('message_start', ({ message }) => {
        if (message.role === 'user') reset();
      });
      pi.on('agent_settled', reset);
      pi.on('context', ({ messages }) => {
        const isMarker = (m: (typeof messages)[number]) =>
          m.role === 'custom' && m.customType === MEMORY_REVIEW_MESSAGE;
        const last = messages.findLastIndex(isMarker);
        if (last < 0) return;
        return { messages: messages.filter((m, i) => !isMarker(m) || (reviewing && i === last)) };
      });
      pi.on('turn_start', (_event, ctx) => {
        if (reviewing && ++requests > MAX_REVIEW_REQUESTS) {
          lifecycle.fail?.('回答已完成；项目记忆整理超过本轮请求上限。');
          ctx.abort();
        }
      });
      pi.on('tool_call', ({ toolName, input }) => {
        if (!reviewing) return;
        if (
          !enabled() ||
          !REVIEW_TOOLS.has(toolName) ||
          !('spaceId' in input) ||
          input.spaceId !== 'project'
        )
          return {
            block: true,
            reason:
              'Wiki closeout only allows direct memory tools in the current project. Use spaceId="project".',
          };
      });
      pi.on('tool_result', (event) => {
        if (reviewing && REVIEW_TOOLS.has(event.toolName) && event.toolName !== 'memory_upsert') {
          if (event.isError) failedReads.add(event.toolName);
          else failedReads.delete(event.toolName);
        }
        if (event.toolName !== 'memory_upsert') return;
        // Tool success at the SDK level is insufficient: pending_review is a successful RPC too.
        const part = event.content.find((p) => p.type === 'text');
        let saved = false;
        if (!event.isError && part?.type === 'text') {
          try {
            const r = event.details ?? JSON.parse(part.text);
            saved =
              r?.written === true &&
              (r.status === 'created' || r.status === 'updated') &&
              typeof r.relPath === 'string';
          } catch {
            /* not a memory write receipt */
          }
        }
        written ||= saved;
        writeFailed = !saved;
      });
      pi.on('agent_before_settle', (event, ctx) => {
        if (
          event.outcome !== 'completed' ||
          ctx.signal?.aborted ||
          !enabled() ||
          event.continue ||
          event.context.pendingMessages.length
        )
          return;
        const last = event.context.contextMessages.at(-1);
        const answer =
          last?.role === 'assistant' && last.stopReason === 'stop'
            ? last.content
                .flatMap((p) => (p.type === 'text' ? [p.text] : []))
                .join('\n')
                .trim()
            : '';
        if (reviewing) {
          if (writeFailed || (!written && (failedReads.size > 0 || !NO_CHANGE.includes(answer)))) {
            lifecycle.fail?.('回答已完成；本轮项目记忆未确认保存。请查看记忆工具结果。');
          }
          return;
        }
        if (!answer || (written && !writeFailed)) return;
        reviewing = true;
        lifecycle.start?.();
        return {
          entries: [
            ...event.entries,
            {
              type: 'custom_message' as const,
              customType: MEMORY_REVIEW_MESSAGE,
              content: REVIEW_PROMPT,
              display: false,
            },
          ],
          continue: true,
        };
      });
    },
  };
}
