import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { __ActivityTabContext } from '../vetta/sdk/activity-tab';
import type { PluginFsApi } from '../vetta/sdk/fs';
import { useNotesAutoDispatch } from '../vetta/src/notes/handoff';
import { NotesStore } from '../vetta/src/notes/notes-store';
import { setPluginCtx } from '../vetta/src/plugin-context';
import {
  createDesignContext,
  emitDesignConversation,
  syncDesignConversationActivity,
} from './context';
import { useDesignRegistry } from './registry';

const { state, send, settings } = vi.hoisted(() => {
  const send = vi.fn(async () => null);
  return {
    send,
    state: {
      activeId: 'owner',
      conversations: { owner: { id: 'owner', projectId: 'p', status: 'idle' } },
      send,
    },
    settings: {
      projects: [{ id: 'p', path: '/w' }],
      projectGroups: [],
      providers: [],
      language: 'en',
    },
  };
});
vi.mock('@/stores/sessions', () => ({ useSessionsStore: { getState: () => state } }));
vi.mock('@/stores/settings', () => ({ useSettingsStore: { getState: () => settings } }));
vi.mock('@/stores/modelDirectory/useProviders', () => ({ readMaterializedProviders: () => [] }));
vi.mock('@/stores/oauthCredentials', () => ({
  oauthCredentialContext: () => ({}),
  useOauthCredentialStore: { getState: () => ({}) },
}));
vi.mock('@shared/defaultModel', () => ({
  scopedDefaultModels: () => ({}),
  resolveChatModel: () => ({ source: 'global', providerId: 'p1', modelId: 'm1' }),
}));
vi.mock('@/components/ui/toast', () => ({ addToast: vi.fn() }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Harness({ notes }: { notes: NotesStore }) {
  useNotesAutoDispatch(notes, '/w');
  return null;
}
afterEach(() => {
  vi.useRealTimers();
  send.mockClear();
  state.activeId = 'owner';
  state.conversations.owner.status = 'idle';
  useDesignRegistry.setState({ canvasSessionId: null });
});

it.each(['idle', 'running', 'changed', 'race'])(
  'notes -> SDK -> session.send obeys owner and idle gate (%s)',
  async (mode) => {
    vi.useFakeTimers();
    setPluginCtx(createDesignContext());
    useDesignRegistry.setState({ canvasSessionId: 'owner' });
    emitDesignConversation({
      type: 'conversation-changed',
      conversation: { id: 'owner', cwd: '/w', sessionPath: null, model: null, isStreaming: false },
    });
    const notes = new NotesStore(
      {
        readFile: async () => {
          throw new Error('missing');
        },
        writeFile: async () => {},
      } as unknown as PluginFsApi,
      '/w/a.vetd'
    );
    await notes.load();
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => {
        root.render(
          <__ActivityTabContext.Provider value={{ sessionId: 'owner', cwd: '/w', active: true }}>
            <Harness notes={notes} />
          </__ActivityTabContext.Provider>
        );
      });
      if (mode === 'running')
        act(() => {
          state.conversations.owner.status = 'running';
          syncDesignConversationActivity('owner', true);
        });
      act(() => {
        notes.addNote(
          {
            kind: 'element',
            frameId: 'home',
            fx: 1,
            fy: 2,
            element: {
              source: 'frames/home.tsx:42',
              domPath: 'main > button',
              tag: 'button',
              text: 'Hi',
              classes: '',
            },
          },
          'Change title'
        );
      });
      if (mode === 'changed') state.activeId = 'elsewhere';
      if (mode === 'race') state.conversations.owner.status = 'running';
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });
      if (mode === 'idle') {
        expect(send).toHaveBeenCalledWith(
          expect.stringContaining('Call vetd_notes with no arguments'),
          { providerId: 'p1', modelId: 'm1', cwd: '/w' },
          undefined,
          'owner'
        );
        expect(notes.notes[0].anchor).toMatchObject({
          frameId: 'home',
          element: { source: 'frames/home.tsx:42', domPath: 'main > button' },
        });
      } else expect(send).not.toHaveBeenCalled();
      if (mode === 'running') {
        act(() => {
          state.conversations.owner.status = 'idle';
          syncDesignConversationActivity('owner', false);
          vi.advanceTimersByTime(2000);
        });
        expect(send).not.toHaveBeenCalled();
      }
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  }
);
