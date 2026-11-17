import { isSessionMutedInConversations } from '@shared/sessionMute';

/**
 * 配对目录里每个会话条目的静音标记。
 *
 * 子会话（coworker / 类型化 child）和旁路会话不能单独静音，手机上却会作为
 * 独立条目下发：只读条目自己的 `muted` 会让「静音根会话」的子条目照样计入
 * 主屏角标。所以这里按权威 parent 链回溯到根会话再取值。
 * 只影响推送与角标，条目本身（正文、待审批/待提问数）照常下发。
 */
export function pairCatalogMuted(
  conversations: Record<string, { parentId?: string; btwParentId?: string; muted?: boolean }>,
  conversationId: string
): boolean {
  return isSessionMutedInConversations(conversations, conversationId);
}
