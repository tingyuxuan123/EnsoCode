import type { ConversationAuthorityProjection } from '@shared/types/agent';
import { describe, expect, it } from 'vitest';
import type { Conversation } from './index';
import { emptyProjection } from './reducer';
import { reconcileSuperAssistantAuthority } from './superAssistantProjection';

const authority = (id: string, extra: object = {}): ConversationAuthorityProjection => ({
  conversationId: id,
  projectId: 'project',
  kind: 'root',
  lifecycle: 'draft',
  version: 1,
  ...extra,
});
const base = (): {
  conversations: Record<string, Conversation>;
  order: string[];
  activeId: string | null;
} => ({
  conversations: {
    code: {
      ...emptyProjection,
      id: 'code',
      projectId: 'project',
      title: 'code',
      createdAt: 1,
      started: false,
      spawning: false,
    },
  },
  order: ['code'],
  activeId: 'code' as string | null,
});

describe('super assistant authority projection', () => {
  it('initializes the target model and approval from Main rather than a full-access fallback', () => {
    const result = reconcileSuperAssistantAuthority(base(), [
      authority('target', {
        dispatchedBySuperAssistant: true,
        executionConfig: {
          providerId: 'target-provider',
          modelId: 'target-model',
          approvalMode: 'supervised',
          reasoningEnabled: true,
          thinkingLevel: 'high',
          presetId: 'safe-preset',
        },
      }),
    ]);
    expect(result.conversations.target).toMatchObject({
      lastProviderId: 'target-provider',
      lastModelId: 'target-model',
      approvalMode: 'supervised',
      reasoningEnabled: true,
      thinkingLevel: 'high',
      presetId: 'safe-preset',
    });
  });

  it('adopts coordinator off-list and dispatched targets on-list without selecting either', () => {
    const result = reconcileSuperAssistantAuthority(base(), [
      authority('assistant', {
        superAssistant: true,
        displayTitle: 'Super Assistant',
        createdAt: 2,
      }),
      authority('target', {
        dispatchedBySuperAssistant: true,
        displayTitle: 'Fix quantities',
        createdAt: 3,
      }),
      authority('unrelated'),
    ]);
    expect(result.activeId).toBe('code');
    expect(result.order).toEqual(['target', 'code']);
    expect(result.conversations).toHaveProperty('assistant.title', 'Super Assistant');
    expect(result.conversations).toHaveProperty('target.title', 'Fix quantities');
    expect(result.conversations).not.toHaveProperty('unrelated');
  });

  it('does not replace live output or user titles, and is referentially stable', () => {
    const rows = [
      authority('target', { dispatchedBySuperAssistant: true, displayTitle: 'Original' }),
    ];
    const adopted = reconcileSuperAssistantAuthority(base(), rows);
    const live = {
      ...adopted,
      conversations: {
        ...adopted.conversations,
        target: {
          ...adopted.conversations.target,
          title: 'User title',
          status: 'running' as const,
          messages: [
            { role: 'assistant' as const, content: [{ type: 'text' as const, text: 'live' }] },
          ],
        },
      },
    };
    expect(reconcileSuperAssistantAuthority(live, rows)).toBe(live);
    expect(live.conversations.target.messages[0].content).toEqual([{ type: 'text', text: 'live' }]);
  });

  it('ignores ended and child records; strips an accidentally listed coordinator', () => {
    const result = reconcileSuperAssistantAuthority({ ...base(), order: ['assistant', 'code'] }, [
      authority('assistant', { superAssistant: true }),
      authority('ended', { superAssistant: true, lifecycle: 'ended' }),
      authority('child', { dispatchedBySuperAssistant: true, kind: 'child' }),
    ]);
    expect(result.order).toEqual(['code']);
    expect(result.conversations).not.toHaveProperty('ended');
    expect(result.conversations).not.toHaveProperty('child');
  });
});
