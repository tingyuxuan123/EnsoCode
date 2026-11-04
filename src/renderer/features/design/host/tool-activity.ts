import type { ProjectedMessage } from '@shared/types/agent';
import type { ConversationEvent } from '../vetta/sdk/conversation';

/**
 * 会话投影 → 设计插件的工具活动事件（tool-call-args / tool-call-end）。
 *
 * 画布的「浏览中 / 修改中 / 创作中 / 已更新」只认这两类事件；上游由宿主
 * 从 toolcall_delta / tool.end 翻译，EnsoCode 的权威源是会话投影，这里按
 * 投影差分得到同样的事件。只转发与单个文件路径对应的读写工具。
 */
type ToolActivityEvent = Extract<ConversationEvent, { type: 'tool-call-args' | 'tool-call-end' }>;

interface ActivityCall {
  id: string;
  toolName: 'read' | 'edit' | 'write';
  path: string;
}

const PATH_KEYS = ['path', 'file_path', 'filePath'] as const;
const HASHLINE_HEADER = /^\[(.+)#([0-9A-Fa-f]{4})\]$/;
const PATCH_HEADER = /^\*\*\* (Add File|Update File|Move to): (.+)$/;

function directPath(args: Record<string, unknown>): string | undefined {
  for (const key of PATH_KEYS) {
    const value = args[key];
    if (typeof value === 'string' && value) return value;
  }
  if (typeof args.input === 'string') {
    const first = args.input.split('\n').find((line) => line.trim());
    return first ? HASHLINE_HEADER.exec(first.trim())?.[1] : undefined;
  }
  return undefined;
}

function activityCalls(id: string, name: string, args: unknown): ActivityCall[] {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return [];
  const record = args as Record<string, unknown>;
  if (name === 'apply_patch') {
    if (typeof record.input !== 'string') return [];
    const calls: ActivityCall[] = [];
    // 流式中最后一行可能是半截路径：只认已换行的完整头部。
    const lines = record.input.split('\n');
    lines.pop();
    for (const line of lines) {
      const match = PATCH_HEADER.exec(line.trim());
      if (!match) continue;
      const toolName = match[1] === 'Add File' ? 'write' : 'edit';
      calls.push({ id: `${id}#${calls.length}`, toolName, path: match[2] });
    }
    return calls;
  }
  if (name !== 'read' && name !== 'edit' && name !== 'write') return [];
  const path = directPath(record);
  return path ? [{ id, toolName: name, path }] : [];
}

/** 当前轮次窗口：最后一条 user 消息之后的部分（之前的调用都已收口）。 */
function turnWindow(messages: readonly ProjectedMessage[]): readonly ProjectedMessage[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return messages.slice(i + 1);
  }
  return messages;
}

export function createDesignToolActivity() {
  let sessionId: string | null | undefined;
  /** toolCallId → 已发出的子调用（路径），用于去重与收场。 */
  let lit = new Map<string, ActivityCall[]>();
  let settled = new Set<string>();

  return {
    sync(
      nextSessionId: string | null,
      messages: readonly ProjectedMessage[],
      running: boolean
    ): ToolActivityEvent[] {
      const window = turnWindow(messages);
      const results = new Map<string, boolean>();
      for (const message of window) {
        if (message.role === 'toolResult' && message.toolCallId)
          results.set(message.toolCallId, message.isError === true);
      }
      // 首次同步或换了会话：现存调用一律当作历史，静默收下。
      const baseline = nextSessionId !== sessionId;
      if (baseline) {
        sessionId = nextSessionId;
        lit = new Map();
        settled = new Set();
      }
      const events: ToolActivityEvent[] = [];
      const seen = new Set<string>();
      for (const message of window) {
        if (message.role !== 'assistant') continue;
        for (const part of message.content) {
          if (part.type !== 'toolCall') continue;
          seen.add(part.id);
          if (settled.has(part.id)) continue;
          const isError = results.get(part.id);
          if (baseline || (!running && isError === undefined)) {
            settled.add(part.id);
            continue;
          }
          const previous = lit.get(part.id) ?? [];
          const calls = activityCalls(part.id, part.name, part.arguments);
          for (const call of calls) {
            if (previous.some((p) => p.id === call.id && p.path === call.path)) continue;
            events.push({
              type: 'tool-call-args',
              toolCallId: call.id,
              toolName: call.toolName,
              args: { path: call.path },
            });
          }
          const current = calls.length >= previous.length ? calls : previous;
          if (isError === undefined) {
            if (current.length) lit.set(part.id, current);
            continue;
          }
          for (const call of current) {
            events.push({
              type: 'tool-call-end',
              toolCallId: call.id,
              toolName: call.toolName,
              isError,
            });
          }
          lit.delete(part.id);
          settled.add(part.id);
        }
      }
      // 窗口滑走的调用不会再出现，丢掉记录免得无限增长。
      for (const id of settled) if (!seen.has(id)) settled.delete(id);
      for (const id of lit.keys()) if (!seen.has(id)) lit.delete(id);
      return events;
    },
  };
}
