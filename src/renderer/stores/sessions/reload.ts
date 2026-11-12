import { projectSafeJournal } from '@shared/safeJournalProjection';
import type { ConversationReloadResult, RendererAgentEvent } from '@shared/types/agent';
import { applyAgentEvent, retainedOptimisticTail, type SessionProjection } from './reducer';

/**
 * 手动「重新读取会话」的纯归并。与自动 snapshot 分支刻意不同：
 * - 只替换权威正文 / customEntries（及 live 的 pending 审批提问、后台任务、子代理），
 *   不清运行计时、Main dispatch 流、工具输出，不动 started / error 等 store 层字段；
 * - live 快照带事件 seq 水位：lastSeq 直接置为水位，请求在途期间缓冲的实时事件按序重放
 *   （水位之前的已被快照覆盖，靠单调守卫自然丢弃），IPC reply 迟到也不会让正文倒退；
 * - 失败原对象返回，一字不改。
 */
export function applyConversationReload(
  state: SessionProjection,
  sessionId: string,
  result: ConversationReloadResult,
  buffered: readonly RendererAgentEvent[],
  now: number = Date.now()
): SessionProjection {
  if (!result.ok) return state;

  if (result.source === 'history') {
    const timeline = projectSafeJournal(result.projection.records);
    return { ...state, messages: timeline.messages, customEntries: timeline.customEntries };
  }

  if (result.source === 'tail') {
    const tail = retainedOptimisticTail(state.messages, result.messages, state.generation);
    return {
      ...state,
      messages: tail.length > 0 ? [...result.messages, ...tail] : result.messages,
      historyBaseIndex: result.baseIndex > 0 ? result.baseIndex : undefined,
    };
  }

  const { snapshot, seq } = result;
  const tail = retainedOptimisticTail(
    state.messages,
    snapshot.messages,
    snapshot.identity.generation
  );
  const sameGeneration = state.generation === snapshot.identity.generation;
  const snapBase = snapshot.baseIndex ?? 0;
  const reloaded: SessionProjection = {
    ...state,
    generation: snapshot.identity.generation,
    status: snapshot.status,
    messages: tail.length > 0 ? [...snapshot.messages, ...tail] : snapshot.messages,
    customEntries: snapshot.customEntries ?? [],
    commands: snapshot.commands,
    pendingApprovals: snapshot.pendingApprovals ?? [],
    pendingAsks: snapshot.pendingAsks ?? [],
    backgroundTasks: snapshot.backgroundTasks ?? [],
    subagents: snapshot.subagents ?? [],
    historyBaseIndex: snapBase > 0 ? snapBase : undefined,
    lastSeq: seq,
    // 代际变了说明是另一次 spawn 的会话：本地计时 / 派发流 / 工具输出都属于旧代
    ...(sameGeneration
      ? {}
      : { activeMs: 0, runStartedAt: undefined, dispatchMainEvents: {}, toolOutputs: {} }),
  };
  return buffered.reduce(
    (current, event) => applyAgentEvent(current, sessionId, event, now),
    reloaded
  );
}
