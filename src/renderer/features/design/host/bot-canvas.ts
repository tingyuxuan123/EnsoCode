import { activeThreadOf } from '@shared/bots/threads';
import { create } from 'zustand';
import { useBotsStore } from '@/stores/bots';
import { isBotModeActive } from '@/stores/bots/mode';
import { useSettingsStore } from '@/stores/settings';

export interface BotDesignTarget {
  chatId: string;
  sessionId?: string;
  cwd: string;
  path: string;
  projectId?: string;
}

export const useBotDesignCanvas = create<{
  target: BotDesignTarget | null;
  workspaceKey: string | null;
}>(() => ({
  target: null,
  workspaceKey: null,
}));

export function isViewedBotDesignChat(chatId: string): boolean {
  if (!isBotModeActive() || !useSettingsStore.getState().designEnabled) return false;
  const { view, chats } = useBotsStore.getState();
  if (view?.kind !== 'chat') return false;
  const root = chats.find((chat) => chat.id === view.chatId);
  return Boolean(root && activeThreadOf(chats, root).id === chatId);
}

/** Both tool-driven opens and message cards are scoped to the currently viewed topic. */
export function revealBotDesign(target: BotDesignTarget): void {
  if (!isViewedBotDesignChat(target.chatId)) return;
  const panel = useBotsStore.getState();
  const chat = panel.chats.find((item) => item.id === target.chatId);
  if (!chat) return;
  const projectId = chat.workspace.kind === 'project' ? chat.workspace.projectId : null;
  const path = useSettingsStore.getState().projects.find((item) => item.id === projectId)?.path;
  useBotDesignCanvas.setState({
    target,
    workspaceKey: JSON.stringify([chat.id, chat.workspace, path]),
  });
  if (!panel.panelOpen) panel.togglePanel();
  panel.setPanelTab('design');
}
