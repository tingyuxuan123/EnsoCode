import { type DesignActivityCall, designActivityCalls } from '@shared/design/toolActivity';
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

/** Detached windows may receive activity before their async binding/controller is ready. */
export function createDesignActivityReplay() {
  const active = new Map<string, Extract<ToolActivityEvent, { type: 'tool-call-args' }>>();
  return {
    accept(events: readonly ToolActivityEvent[], ready: boolean): readonly ToolActivityEvent[] {
      for (const event of events) {
        if (event.type === 'tool-call-args') active.set(event.toolCallId, event);
        else active.delete(event.toolCallId);
      }
      return ready ? events : [];
    },
    pending: (): ToolActivityEvent[] => [...active.values()],
    clear: () => active.clear(),
  };
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
  let lit = new Map<string, DesignActivityCall[]>();
  let settled = new Set<string>();

  return {
    sync(
      nextSessionId: string | null,
      messages: readonly ProjectedMessage[],
      running: boolean,
      runtimeCalls: readonly DesignActivityCall[] = []
    ): ToolActivityEvent[] {
      const window = [...turnWindow(messages)];
      // Runtime feedback has no transcript entry; adapt it without persisting synthetic messages.
      for (const call of runtimeCalls) {
        window.push({
          role: 'assistant',
          content: [
            { type: 'toolCall', id: call.id, name: call.toolName, arguments: { path: call.path } },
          ],
        });
        if (call.isError !== undefined)
          window.push({
            role: 'toolResult',
            toolCallId: call.id,
            isError: call.isError,
            content: [],
          });
      }
      const results = new Map<string, boolean>();
      for (const message of window) {
        if (message.role === 'toolResult' && message.toolCallId)
          results.set(message.toolCallId, message.isError === true);
      }
      // Completed history stays silent; in-flight calls must resume on a mid-turn mount.
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
          if ((baseline && isError !== undefined) || (!running && isError === undefined)) {
            settled.add(part.id);
            continue;
          }
          const previous = lit.get(part.id) ?? [];
          const calls = designActivityCalls(part.id, part.name, part.arguments);
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
