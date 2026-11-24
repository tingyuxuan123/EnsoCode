import { allowsCoworkerModelChange } from '@shared/types/agent';
import type { TimelineMessage } from './reducer';

/** Keep the policy independent of the desktop store: the phone reuses child tab eligibility. */
type CoworkerModelState = {
  parentId?: string;
  child?: Parameters<typeof allowsCoworkerModelChange>[0];
  ended?: boolean;
  historyOnly?: boolean;
  modelSwitchPending?: boolean;
  started: boolean;
  generation?: string;
  spawning: boolean;
  status: string;
  compaction?: 'queued' | 'running';
  queuedMessages?: readonly unknown[];
  messages: readonly Pick<TimelineMessage, 'optimistic' | 'deliveryRejected'>[];
  workspaceMigrating?: boolean;
};

export function coworkerModelControl(conversation: CoworkerModelState) {
  if (
    !conversation.parentId ||
    !allowsCoworkerModelChange(conversation.child) ||
    conversation.ended ||
    conversation.historyOnly
  )
    return 'hidden';
  if (conversation.modelSwitchPending) return 'pending';
  if (!conversation.started || !conversation.generation || conversation.spawning)
    return 'unavailable';
  if (
    conversation.status === 'running' ||
    conversation.compaction ||
    conversation.queuedMessages?.length ||
    conversation.messages.some((message) => message.optimistic && !message.deliveryRejected)
  )
    return 'busy';
  return conversation.status === 'idle' && !conversation.workspaceMigrating
    ? 'ready'
    : 'unavailable';
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** 交互标签只对应直属、在编、未结束的持久协作者；关闭视图不改变这份资格。 */
export function canSelectCoworkerTab(
  conversations: Record<string, unknown>,
  parentId: string,
  childId: string
): boolean {
  const parent = record(conversations[parentId]);
  const child = record(conversations[childId]);
  const metadata = record(child?.child);
  return Boolean(
    parent &&
      child &&
      childId !== parentId &&
      !parent.parentId &&
      !parent.btwParentId &&
      !parent.child &&
      child.parentId === parentId &&
      (!metadata?.parentId || metadata.parentId === parentId) &&
      Array.isArray(parent.coworkerIds) &&
      parent.coworkerIds.includes(childId) &&
      (metadata?.mode === undefined || metadata.mode === 'coworker') &&
      child.ended !== true &&
      child.historyOnly !== true
  );
}
