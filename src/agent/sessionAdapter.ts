import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { AgentSession, InlineExtension } from '@earendil-works/pi-coding-agent';
import { projectMessage } from './projection';
import {
  isSilentAssistantTurn,
  POST_TOOL_EMPTY_NUDGE,
  SILENT_TURN_NUDGE,
  type SilentTurnKind,
} from './silentTurn';
import { transcriptMessages } from './transcript';

export const OAUTH_POOL_TERMINAL_ERROR_ENTRY = 'enso.oauth-pool-terminal-error';

/** Pi 1.0：仅在本次 steer 的同步入队点检查活轮，不触碰 prompt 的压缩/nextTurn 副作用。
 * 每次调用独立代理，不替换共享 session 方法；私有队列形状由真实 SDK 契约测试锁定。
 */
export async function steerActiveSession(
  session: AgentSession,
  text: string,
  images: Parameters<AgentSession['steer']>[1],
  onQueued: (detach: () => boolean) => void,
  prepareText: (text: string) => string = (text) => text
): Promise<'queued' | 'handled' | 'deferred'> {
  if (!session.isStreaming || session.isRetrying) return 'deferred';
  const adapter = session as unknown as {
    _queueSteer: (text: string, images: Parameters<AgentSession['steer']>[1]) => Promise<void>;
    _emitQueueUpdate: () => void;
  };
  const queue = (session.agent as unknown as { steeringQueue?: { messages?: unknown[] } })
    .steeringQueue;
  if (!Array.isArray(queue?.messages) || typeof adapter._queueSteer !== 'function')
    throw new Error('Unsupported Pi steering adapter');
  const pendingQueue = queue as { messages: unknown[] };
  const deferred = new Error('active turn ended before steering');
  const guarded = new Proxy(session, {
    get(target, key, receiver) {
      if (key !== '_queueSteer') return Reflect.get(target, key, receiver);
      return (input: string, attached: Parameters<AgentSession['steer']>[1]) => {
        if (!target.isStreaming || target.isRetrying) throw deferred;
        const queuedText = prepareText(input);
        const result = adapter._queueSteer(queuedText, attached);
        const message = pendingQueue.messages.at(-1);
        onQueued(() => {
          const messages = pendingQueue.messages;
          const index = messages.indexOf(message);
          if (index < 0) return false;
          messages.splice(index, 1);
          const labels = session.getSteeringMessages() as string[];
          const label = labels.indexOf(queuedText);
          if (label >= 0) labels.splice(label, 1);
          adapter._emitQueueUpdate();
          return true;
        });
        return result;
      };
    },
  });
  try {
    return await guarded.steer(text, images);
  } catch (error) {
    if (error === deferred) return 'deferred';
    throw error;
  }
}

/**
 * 空回复恢复：`turn_end` 用 context_edit 从模型上下文拿掉空 assistant 并 continue，
 * 恢复轮的请求经 context hook 临时追加 nudge。轮次类型看最近的 user/toolResult，跳过 system entry。
 */
export function silentTurnRecoveryExtension(
  onRecovery: (kind: SilentTurnKind) => void
): InlineExtension {
  return {
    name: 'silent-turn-recovery',
    hidden: true,
    factory: (pi) => {
      let recoveredThisRun = false;
      let activeNudge: string | undefined;

      pi.on('agent_start', () => {
        recoveredThisRun = false;
        activeNudge = undefined;
      });

      pi.on('context', (event, context) => {
        if (!activeNudge) return;
        if (context.signal?.aborted) {
          activeNudge = undefined;
          return;
        }
        return {
          messages: [
            ...event.messages,
            {
              role: 'user',
              content: [{ type: 'text', text: activeNudge }],
              timestamp: Date.now(),
            },
          ],
        };
      });

      pi.on('turn_end', (event, context) => {
        if (event.outcome !== 'completed' || context.signal?.aborted) {
          activeNudge = undefined;
          return;
        }

        if (activeNudge) {
          if (
            event.message.role === 'assistant' &&
            event.message.content.some((part) => part.type === 'toolCall')
          ) {
            return;
          }
          activeNudge = undefined;
          return;
        }

        if (recoveredThisRun || event.message.role !== 'assistant') return;
        const assistant = projectMessage(event.message);
        if (!isSilentAssistantTurn(assistant ?? undefined)) return;

        const branch = context.sessionManager.getBranch();
        const currentEntryIndex = branch.findIndex((entry) => entry.id === event.messageEntryId);
        if (currentEntryIndex < 0) return;
        const previousEntry = branch
          .slice(0, currentEntryIndex)
          .reverse()
          .find(
            (entry) =>
              entry.type === 'message' &&
              (entry.message.role === 'user' || entry.message.role === 'toolResult')
          );
        const previous = previousEntry?.type === 'message' ? previousEntry.message : undefined;
        const previousMessage = projectMessage(previous);
        if (previousMessage?.role !== 'user' && previousMessage?.role !== 'toolResult') return;

        const kind: SilentTurnKind = previousMessage.role === 'toolResult' ? 'post-tool' : 'empty';
        recoveredThisRun = true;
        activeNudge = kind === 'post-tool' ? POST_TOOL_EMPTY_NUDGE : SILENT_TURN_NUDGE;
        onRecovery(kind);

        return {
          entries: [
            ...event.entries,
            {
              type: 'context_edit',
              targetId: event.messageEntryId,
              replacement: null,
            },
          ],
          continue: true,
        };
      });
    },
  };
}

/** 手动重试：把最新 assistant 从模型上下文拿掉，jsonl 原条目保留 */
export function editLatestAssistantForRetry(session: AgentSession): boolean {
  const projection = session.sessionManager.buildSessionProjection();
  const latestVisible = [...projection.entries]
    .reverse()
    .find((entry) => entry.messages.length > 0);
  if (
    latestVisible?.sourceEntry.type !== 'message' ||
    latestVisible.sourceEntry.message.role !== 'assistant' ||
    latestVisible.messages.at(-1)?.role !== 'assistant'
  ) {
    return false;
  }

  session.sessionManager.appendContextEdit(latestVisible.sourceEntry.id, null);
  session.refreshContext();
  return true;
}

/**
 * 无新增消息的活动续跑：pi 1.4.0 没有公开的 session.continue，裸 agent.continue 会绕过
 * 自动重试、agent_before_settle 和 agent_settled。用 custom 触发准备扩展提示词，去掉合成消息，
 * 保留无新增任务语义：不重跑用户 prompt hook、不消费 nextTurn、不重放任务/工具。
 * 不替换共享 session 方法；取消与唯一结算仍由 SDK 管理。升级复检点见 main/services.md。
 *
 * Pi 1.4.0 exposes no session.continue. Per-call proxies prepare custom-run prompt rules,
 * omit the synthetic trigger and preserve nextTurn messages. The SDK owns retry, abort
 * and settlement. Never replace methods on the shared session or skip prompt preparation.
 */
export async function continueSessionActivity(session: AgentSession): Promise<void> {
  // SDK 在异步 settled hook 期间已将 isIdle 置 true，但新活动必须等整次结算结束。
  const settling = (session as unknown as { _isEmittingAgentSettled?: boolean })
    ._isEmittingAgentSettled;
  if (!session.isIdle || settling) throw new Error('Cannot continue a busy session.');
  const messages = session.agent.state.messages;
  const last = messages.at(-1);
  if (!last || messages.every((message) => message.role === 'system')) {
    throw new Error('No messages to continue from');
  }
  if (last.role === 'assistant') throw new Error('Cannot continue from message role: assistant');
  const trigger = {
    messageType: 'custom' as const,
    message: {
      role: 'custom' as const,
      customType: 'enso-activity-continuation',
      content: [],
      display: false,
      timestamp: Date.now(),
    },
  };
  type ContinuationTrigger = typeof trigger;
  const adapter = session as unknown as {
    _startRun(trigger: ContinuationTrigger): Promise<void>;
    _prepareRun(trigger: ContinuationTrigger): Promise<AgentMessage[]>;
  };
  if (typeof adapter._startRun !== 'function' || typeof adapter._prepareRun !== 'function') {
    throw new Error('Pi SDK no longer supports message-free activity continuation.');
  }
  const continuation = new Proxy(adapter, {
    get(target, key, receiver) {
      if (key === '_prepareRun') {
        return async () => {
          // 准备阶段隔离 nextTurn 的读写，不暂存/替换共享数组，避免异步 hook 吞掉新消息。
          const preparation = new Proxy(target, {
            get(inner, property, innerReceiver) {
              if (property === '_pendingNextTurnMessages') return [];
              return Reflect.get(inner, property, innerReceiver);
            },
            set(inner, property, value, innerReceiver) {
              if (property === '_pendingNextTurnMessages') return true;
              return Reflect.set(inner, property, value, innerReceiver);
            },
          });
          const prepared = await preparation._prepareRun(trigger);
          return prepared.filter((message) => message !== trigger.message);
        };
      }
      return Reflect.get(target, key, receiver);
    },
  });
  await continuation._startRun(trigger);
}

/** context_edit 只作用于模型上下文，渲染层记录仍展示原始消息 */
export function buildSessionDisplayMessages(
  session: AgentSession,
  contextMessages: unknown[] = session.messages as unknown[]
): unknown[] {
  const manager = session.sessionManager as AgentSession['sessionManager'] & {
    buildSessionProjection?: AgentSession['sessionManager']['buildSessionProjection'];
  };
  const projection = manager.buildSessionProjection?.();
  if (!projection) return transcriptMessages(manager, contextMessages);

  const editedTargets = new Set<string>();
  const terminalErrors = new Map<string, string>();
  for (const entry of manager.getBranch()) {
    if (entry.type === 'context_edit') editedTargets.add(entry.targetId);
    if (
      entry.type === 'custom' &&
      entry.customType === OAUTH_POOL_TERMINAL_ERROR_ENTRY &&
      entry.data &&
      typeof entry.data === 'object'
    ) {
      const data = entry.data as Record<string, unknown>;
      if (typeof data.targetId === 'string' && typeof data.error === 'string')
        terminalErrors.set(data.targetId, data.error);
    }
  }

  const displayContext = projection.entries.flatMap((entry) => {
    const error = terminalErrors.get(entry.sourceEntry.id);
    if (
      error &&
      entry.sourceEntry.type === 'message' &&
      entry.sourceEntry.message.role === 'assistant'
    )
      return [{ ...entry.sourceEntry.message, errorMessage: error }];
    if (entry.sourceEntry.type === 'message' && editedTargets.has(entry.sourceEntry.id)) {
      return [entry.sourceEntry.message];
    }
    return entry.messages;
  });
  return transcriptMessages(manager, displayContext);
}
