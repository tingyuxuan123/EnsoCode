import type { ConversationAuthorityProjection } from '@shared/types/agent';
import type { Conversation } from './index';
import { emptyProjection } from './reducer';

type Slice = {
  conversations: Record<string, Conversation>;
  order: string[];
  activeId: string | null;
};

/** Keeps the retired coordinator's cached metadata without selecting or listing it. */
export function hideRetiredCoordinator<T extends Slice>(state: T): T {
  const retired = (id: string) => state.conversations[id]?.superAssistant === true;
  const activeId = state.activeId && retired(state.activeId) ? null : state.activeId;
  const order = state.order.some(retired) ? state.order.filter((id) => !retired(id)) : state.order;
  return activeId === state.activeId && order === state.order
    ? state
    : { ...state, activeId, order };
}

/** Adopts ordinary Code roots that the retired coordinator created in Main. */
export function restoreLegacyDispatchedConversations<T extends Slice>(
  state: T,
  authority: readonly ConversationAuthorityProjection[]
): T {
  let conversations = state.conversations;
  let order = state.order;
  for (const row of authority) {
    if (
      row.kind !== 'root' ||
      row.lifecycle === 'ended' ||
      row.bot ||
      row.superAssistant ||
      !row.dispatchedBySuperAssistant
    )
      continue;
    const previous = conversations[row.conversationId];
    const config = row.executionConfig;
    const model =
      previous?.lastProviderId && previous.lastModelId ? undefined : (row.selection ?? config);
    const restored = {
      sessionFile: previous?.sessionFile ?? row.sessionFile,
      lastProviderId: model?.providerId ?? previous?.lastProviderId,
      lastModelId: model?.modelId ?? previous?.lastModelId,
      approvalMode: previous?.approvalMode ?? config?.approvalMode,
      reasoningEnabled: previous?.reasoningEnabled ?? config?.reasoningEnabled,
      thinkingLevel: previous?.thinkingLevel ?? config?.thinkingLevel,
      presetId: previous?.presetId ?? config?.presetId,
    };
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
          ...restored,
        },
      };
      if (!order.includes(row.conversationId)) order = [row.conversationId, ...order];
    } else if (
      restored.sessionFile !== previous.sessionFile ||
      restored.lastProviderId !== previous.lastProviderId ||
      restored.lastModelId !== previous.lastModelId ||
      restored.approvalMode !== previous.approvalMode ||
      restored.reasoningEnabled !== previous.reasoningEnabled ||
      restored.thinkingLevel !== previous.thinkingLevel ||
      restored.presetId !== previous.presetId
    ) {
      conversations = {
        ...conversations,
        [row.conversationId]: { ...previous, ...restored },
      };
    }
  }
  return hideRetiredCoordinator(
    conversations === state.conversations && order === state.order
      ? state
      : { ...state, conversations, order }
  );
}
