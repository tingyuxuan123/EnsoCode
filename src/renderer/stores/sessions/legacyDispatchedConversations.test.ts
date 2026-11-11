import type { ConversationAuthorityProjection } from '@shared/types/agent';
import { describe, expect, it } from 'vitest';
import type { Conversation } from './index';
import { restoreLegacyDispatchedConversations } from './legacyDispatchedConversations';
import { emptyProjection } from './reducer';

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

describe('legacy dispatched Code projection', () => {
  it('initializes the target model and approval from Main rather than a full-access fallback', () => {
    const result = restoreLegacyDispatchedConversations(base(), [
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

  it('does not restore the retired coordinator, but still adopts ordinary dispatched targets', () => {
    const result = restoreLegacyDispatchedConversations(base(), [
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
    expect(result.conversations).not.toHaveProperty('assistant');
    expect(result.conversations).toHaveProperty('target.title', 'Fix quantities');
    expect(result.conversations).not.toHaveProperty('unrelated');
  });

  it('fills missing cached model and execution settings without replacing user choices', () => {
    const state = base();
    const row = authority('code', {
      dispatchedBySuperAssistant: true,
      sessionFile: '/history.jsonl',
      selection: { providerId: 'original-provider', modelId: 'original-model', revision: 1 },
      executionConfig: {
        providerId: 'initial-provider',
        modelId: 'initial-model',
        approvalMode: 'supervised',
        reasoningEnabled: true,
        thinkingLevel: 'high',
        presetId: 'safe-preset',
      },
    });
    state.conversations.code.sessionFile = row.sessionFile;
    state.conversations.code.approvalMode = 'auto-edits';
    state.conversations.code.lastProviderId = 'incomplete-provider';
    const restored = restoreLegacyDispatchedConversations(state, [row]);
    expect(restored.conversations.code).toMatchObject({
      lastProviderId: 'original-provider',
      lastModelId: 'original-model',
      approvalMode: 'auto-edits',
      reasoningEnabled: true,
      thinkingLevel: 'high',
      presetId: 'safe-preset',
    });
    expect(restoreLegacyDispatchedConversations(restored, [row])).toBe(restored);
    const changed = {
      ...restored,
      conversations: {
        ...restored.conversations,
        code: {
          ...restored.conversations.code,
          lastProviderId: 'user-provider',
          lastModelId: 'user-model',
          reasoningEnabled: false,
          thinkingLevel: 'low' as const,
          presetId: 'default',
        },
      },
    };
    expect(restoreLegacyDispatchedConversations(changed, [row])).toBe(changed);
  });

  it('does not replace live output or user titles, and is referentially stable', () => {
    const rows = [
      authority('target', { dispatchedBySuperAssistant: true, displayTitle: 'Original' }),
    ];
    const adopted = restoreLegacyDispatchedConversations(base(), rows);
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
    expect(restoreLegacyDispatchedConversations(live, rows)).toBe(live);
    expect(live.conversations.target.messages[0].content).toEqual([{ type: 'text', text: 'live' }]);
  });

  it('ignores ended and child records; clears a stale coordinator selection without deleting metadata', () => {
    const state = base();
    const assistant = { ...state.conversations.code, id: 'assistant', superAssistant: true };
    const result = restoreLegacyDispatchedConversations(
      {
        ...state,
        activeId: 'assistant',
        order: ['assistant', 'code'],
        conversations: { ...state.conversations, assistant },
      },
      [
        authority('ended', { superAssistant: true, lifecycle: 'ended' }),
        authority('child', { dispatchedBySuperAssistant: true, kind: 'child' }),
      ]
    );
    expect(result.order).toEqual(['code']);
    expect(result.activeId).toBeNull();
    expect(result.conversations.assistant).toBe(assistant);
    expect(result.conversations).not.toHaveProperty('ended');
    expect(result.conversations).not.toHaveProperty('child');
  });
});
