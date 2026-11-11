import type { ConversationAuthorityProjection } from '@shared/types/agent';
import type { Conversation } from './index';
import { emptyProjection } from './reducer';

type Slice = {
  conversations: Record<string, Conversation>;
  order: string[];
  activeId: string | null;
};

export function reconcileSuperAssistantAuthority<T extends Slice>(
  state: T,
  authority: readonly ConversationAuthorityProjection[]
): T {
  let conversations = state.conversations;
  let order = state.order;
  for (const row of authority) {
    if (row.kind !== 'root' || row.lifecycle === 'ended' || row.bot) continue;
    if (!row.superAssistant && !row.dispatchedBySuperAssistant) continue;
    const previous = conversations[row.conversationId];
    const config = row.executionConfig;
    if (!previous) {
      conversations = {
        ...conversations,
        [row.conversationId]: {
          ...emptyProjection,
          id: row.conversationId,
          projectId: row.projectId,
          title: row.displayTitle ?? '',
          createdAt: row.createdAt ?? 0,
          started: false,
          spawning: false,
          superAssistant: row.superAssistant,
          titleLocked: row.superAssistant,
          sessionFile: row.sessionFile,
          lastProviderId: row.selection?.providerId ?? config?.providerId,
          lastModelId: row.selection?.modelId ?? config?.modelId,
          approvalMode: config?.approvalMode,
          reasoningEnabled: config?.reasoningEnabled,
          thinkingLevel: config?.thinkingLevel,
          presetId: config?.presetId,
        },
      };
      if (!row.superAssistant && !order.includes(row.conversationId))
        order = [row.conversationId, ...order];
    } else if (
      (row.superAssistant && !previous.superAssistant) ||
      (row.sessionFile && !previous.sessionFile) ||
      (config && !previous.approvalMode)
    ) {
      conversations = {
        ...conversations,
        [row.conversationId]: {
          ...previous,
          ...(row.superAssistant ? { superAssistant: true, titleLocked: true } : {}),
          sessionFile: previous.sessionFile ?? row.sessionFile,
          approvalMode: previous.approvalMode ?? config?.approvalMode,
        },
      };
    }
    if (row.superAssistant && order.includes(row.conversationId))
      order = order.filter((id) => id !== row.conversationId);
  }
  return conversations === state.conversations && order === state.order
    ? state
    : { ...state, conversations, order };
}
