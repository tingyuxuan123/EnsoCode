// @vitest-environment happy-dom
import type { BotChat } from '@shared/types/bot';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addToast } from '@/components/ui/toast';
import { useBotsStore } from '@/stores/bots';
import { useSettingsStore } from '@/stores/settings';
import { GroupInfoPanel } from './GroupInfoPanel';

vi.mock('@/stores/bots', async () => ({
  useBotsStore: (await import('zustand')).create(() => ({})),
}));
vi.mock('@/stores/settings', async () => ({
  useSettingsStore: (await import('zustand')).create(() => ({})),
}));
vi.mock('@/stores/bots/templateLibrary', () => ({ updateTemplateLibrary: vi.fn() }));
vi.mock('@/components/ui/toast', () => ({ addToast: vi.fn() }));
vi.mock('./BotPresence', () => ({ PresenceAvatar: () => null }));
vi.mock('./GroupBoard', () => ({ GroupDelegations: () => null }));
vi.mock('./MemorySpaceList', () => ({ MemorySpaceList: () => null }));
vi.mock('./NotesEditor', () => ({ NotesEditor: () => null }));
vi.mock('./RoutineList', () => ({ RoutineList: () => null }));
vi.mock('./WorkspaceMenu', () => ({ WorkspaceMenu: () => null }));

const chat: BotChat = {
  id: '11111111-1111-4111-8111-111111111111',
  kind: 'group',
  title: 'Team',
  members: [],
  bossBotId: null,
  workspace: { kind: 'project', projectId: 'p' },
  routing: { mode: 'smart', maxHops: 4, maxTurnsPerBot: 2 },
  pinned: false,
  sessions: {},
  createdAt: 1,
  updatedAt: 1,
  version: 2,
};

let host: HTMLDivElement;
let root: Root;
let updateChat: ReturnType<typeof vi.fn>;
const render = async (group = chat, thread = group) => {
  await act(async () => {
    root.render(
      createElement(GroupInfoPanel, { chat: group, thread, onOpenConversation: vi.fn() })
    );
  });
};
const toggle = () => host.querySelector<HTMLButtonElement>('[role="switch"]');

describe('群信息的本地任务托管', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    updateChat = vi.fn(async () => ({ ok: true, chat }));
    Object.assign(window, { electronAPI: { bots: { updateChat } } });
    useBotsStore.setState({
      bots: [],
      runtime: {},
      upsertChat: vi.fn(),
      refreshChats: vi.fn(async () => {}),
      openDirect: vi.fn(async () => null),
    });
    useSettingsStore.setState({ projects: [], language: 'en' });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('旧群默认关闭，解释明确编号、提醒、本地运行、确认恢复和审批边界', async () => {
    await render();
    expect(toggle()?.getAttribute('aria-checked')).toBe('false');
    expect(toggle()?.getAttribute('aria-label')).toBe('Task supervision (local)');
    expect(host.textContent).toContain(
      'Start a plain-text message with a task number (for example, #3 Safari only)'
    );
    expect(host.textContent).toContain('Get a reminder if execution is interrupted or goes quiet.');
    expect(host.textContent).toContain(
      'Runs locally while the app is open and the computer is awake. Interrupted work is not replayed automatically.'
    );
    expect(host.textContent).toContain('Does not start to-dos or replace approvals.');
    expect(updateChat).not.toHaveBeenCalled();
    await act(async () => toggle()?.click());
    expect(updateChat).toHaveBeenCalledWith({
      chatId: chat.id,
      expectedVersion: chat.version,
      taskSupervision: true,
    });
    expect(useBotsStore.getState().upsertChat).toHaveBeenCalledWith(chat);
  });

  it('在话题中仍读取根群开关、更新根群，中文文案正确', async () => {
    useSettingsStore.setState({ language: 'zh' });
    const enabled = { ...chat, taskSupervision: true as const };
    await render(enabled, { ...chat, id: 'topic', parentId: chat.id });
    expect(toggle()?.getAttribute('aria-checked')).toBe('true');
    expect(toggle()?.getAttribute('aria-label')).toBe('任务托管（本地）');
    expect(host.textContent).toContain('补充直达执行中或等待答复的委派负责人。');
    expect(host.textContent).toContain('仅在应用运行且电脑唤醒时生效。中断后不自动重放');
    await act(async () => toggle()?.click());
    expect(updateChat).toHaveBeenCalledWith({
      chatId: chat.id,
      expectedVersion: chat.version,
      taskSupervision: false,
    });
  });

  it('更新失败沿用已有错误提示和刷新，不乐观授权；私聊不展示开关', async () => {
    updateChat.mockResolvedValue({ ok: false, error: 'conflict' });
    await render();
    await act(async () => toggle()?.click());
    expect(useBotsStore.getState().upsertChat).not.toHaveBeenCalled();
    expect(useBotsStore.getState().refreshChats).toHaveBeenCalled();
    expect(addToast).toHaveBeenCalled();
    expect(toggle()?.getAttribute('aria-checked')).toBe('false');
    await render({ ...chat, kind: 'direct', workspace: { kind: 'member-home' } });
    expect(toggle()).toBeNull();
  });
});
