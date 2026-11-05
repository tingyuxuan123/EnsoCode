import type { TaskBoardNavigation } from '@shared/types/taskBoard';
import { useEffect, useState } from 'react';
import { useBotsStore } from '@/stores/bots';
import { useAppModeStore } from '@/stores/bots/mode';
import { useRemoteNodesStore } from '@/stores/remoteNodes';
import { useSettingsStore } from '@/stores/settings';

export function useTaskBoardNavigation(closeWorkspacePage: () => void): void {
  const enabled = useSettingsStore((state) => state.botModeEnabled);
  const [navigation, setNavigation] = useState<TaskBoardNavigation | null>(null);

  useEffect(() => {
    const { consumeNavigation, onNavigate } = window.electronAPI.taskBoard;
    const consume = () => {
      void consumeNavigation()
        .then((target) => {
          if (target) setNavigation(target);
        })
        .catch((error) => console.warn('[taskboard] navigation unavailable', error));
    };
    // Subscribe even in Code / remote mode and before settings hydration. A cold workbench
    // consumes the pending target after mounting; live pushes only wake the same consumer.
    const unsubscribe = onNavigate(consume);
    consume();
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!enabled || !navigation) return;
    const { chatId } = navigation;
    const hasGroup = () =>
      useBotsStore.getState().chats.some((chat) => chat.id === chatId && chat.kind === 'group');
    let canceled = false;
    const open = () => {
      if (canceled) return;
      setNavigation((current) => (current === navigation ? null : current));
      if (!hasGroup()) return;
      closeWorkspacePage();
      useRemoteNodesStore.getState().switchNode('local');
      useAppModeStore.getState().setMode('bot');
      const bots = useBotsStore.getState();
      if (navigation.kind === 'task') {
        bots.openTask(chatId, navigation.taskId);
      } else {
        if (bots.taskFocus) bots.clearTaskFocus(bots.taskFocus.nonce);
        bots.setView({ kind: 'chat', chatId });
        bots.setPanelTab('board');
        if (!bots.panelOpen) bots.togglePanel();
      }
    };
    // Main validated the target, but a cold or stale renderer may not have its chat yet.
    if (hasGroup()) open();
    else void useBotsStore.getState().refreshChats().then(open);
    return () => {
      canceled = true;
    };
  }, [closeWorkspacePage, enabled, navigation]);
}
