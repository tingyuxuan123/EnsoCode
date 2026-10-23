import type {
  ChildHistoryResult,
  ConversationReloadResult,
  ParentHistoryTailResult,
  SessionReloadResult,
} from '@shared/types/agent';

export interface ConversationReloadDeps {
  /** 该会话当前是否在 worker 内存里活着且就绪（Main 会话索引权威） */
  isLive: (conversationId: string) => boolean;
  /** 是否为 child（coworker / typed mention）：历史格式由 Main 持久化 metadata 决定 */
  isChild: (conversationId: string) => boolean;
  /** 向 worker 要带 seq 水位的只读快照（结果按 requestId 回流，超时/退出即失败） */
  reloadLive: (conversationId: string) => Promise<SessionReloadResult>;
  /** child 的 safe journal 或 pi 尾窗（路径由 Main 自己的持久化元数据推导） */
  readHistory: (conversationId: string) => Promise<ChildHistoryResult>;
  /** 根会话 pi jsonl 尾窗（只读、不 spawn） */
  readParentTail: (conversationId: string) => Promise<ParentHistoryTailResult>;
}

/**
 * 手动重读的来源选择：活会话优先取 worker 快照（含运行中状态），拿不到（超时 / worker 退出）
 * 或本就不在 worker 里则按会话种类读盘：locked child → safe journal，其余 → pi jsonl 尾窗。
 * 只读，绝不 spawn / resume。
 */
export async function reloadConversation(
  conversationId: string,
  deps: ConversationReloadDeps
): Promise<ConversationReloadResult> {
  try {
    if (deps.isLive(conversationId)) {
      const live = await deps.reloadLive(conversationId);
      if (live.ok) return { ok: true, source: 'live', snapshot: live.snapshot, seq: live.seq };
    }
    if (deps.isChild(conversationId)) {
      const history = await deps.readHistory(conversationId);
      return history.ok ? history : { ok: false, error: history.error };
    }
    const tail = await deps.readParentTail(conversationId);
    return tail.ok
      ? { ok: true, source: 'tail', messages: tail.messages, baseIndex: tail.baseIndex }
      : { ok: false, error: tail.error };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
