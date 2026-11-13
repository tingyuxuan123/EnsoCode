import { beforeEach, expect, it, vi } from 'vitest';
import { setDisplayedConversation, setQueueActions, useSessionsStore } from './sessions-store';

const actions = {
  removeQueuedMessage: vi.fn(),
  updateQueuedMessage: vi.fn(),
  sendQueuedNow: vi.fn(),
  interruptAndSendQueued: vi.fn(async () => {}),
  pauseGoal: vi.fn(),
  resumeGoal: vi.fn(),
  clearGoal: vi.fn(),
  rewind: vi.fn(),
  retry: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  setQueueActions(actions);
  setDisplayedConversation({
    id: 'session',
    projectId: '',
    status: 'idle',
    started: true,
    spawning: false,
    messages: [
      { role: 'user', entryId: 'first', content: [] },
      { role: 'assistant', content: [] },
      { role: 'user', entryId: 'second', content: [] },
    ],
  });
});

it('adapts a persisted rewind entry to the existing pair user-index command', () => {
  useSessionsStore.getState().rewind('session', 'first', true);
  expect(actions.rewind).toHaveBeenCalledWith('session', 1, true);
  useSessionsStore.getState().rewind('session', 'removed');
  expect(actions.rewind).toHaveBeenCalledTimes(1);
});

it('retains numeric rewind compatibility for existing pair callers', () => {
  useSessionsStore.getState().rewind('session', 0);
  expect(actions.rewind).toHaveBeenCalledWith('session', 0, undefined);
});

it('adapts queue withdrawal to queue-remove without inventing a delivery command', () => {
  useSessionsStore.getState().withdrawMessage('session', { kind: 'queue', id: 'queued' });
  expect(actions.removeQueuedMessage).toHaveBeenCalledWith('session', 'queued');
  useSessionsStore.getState().withdrawMessage('session', { kind: 'delivery', id: 'optimistic' });
  expect(actions.removeQueuedMessage).toHaveBeenCalledTimes(1);
});

it('目标详情只补读当前手机会话，切走后释放补读回调', async () => {
  const loadOlder = vi.fn();
  setDisplayedConversation(
    {
      id: 'phone',
      projectId: '',
      status: 'idle',
      started: true,
      spawning: false,
      messages: [],
      historyBaseIndex: 80,
      historyLoading: true,
    },
    loadOlder
  );
  expect(useSessionsStore.getState().conversations.phone.historyLoading).toBe(true);
  expect(typeof useSessionsStore.getState().loadOlderHistory).toBe('function');
  await useSessionsStore.getState().loadOlderHistory('other');
  expect(loadOlder).not.toHaveBeenCalled();
  await useSessionsStore.getState().loadOlderHistory('phone');
  expect(loadOlder).toHaveBeenCalledOnce();
  setDisplayedConversation(null);
  await useSessionsStore.getState().loadOlderHistory('phone');
  expect(loadOlder).toHaveBeenCalledOnce();
});
