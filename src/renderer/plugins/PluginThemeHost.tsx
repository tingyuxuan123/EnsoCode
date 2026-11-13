import { useEffect } from 'react';
import { startPluginThemes } from '@/stores/pluginThemes';
import { useSessionsStore } from '@/stores/sessions';
import { displayedConversationId } from '@/stores/sessions/chatChrome';
export function PluginThemeHost() {
  useEffect(startPluginThemes, []);
  useEffect(() => {
    const update = () => {
      const state = useSessionsStore.getState();
      const id = displayedConversationId(state);
      const current = id ? state.conversations[id] : undefined;
      const activity = (conversation: typeof current) =>
        conversation?.error
          ? 'error'
          : conversation?.status === 'running' || conversation?.spawning
            ? 'running'
            : 'waiting';
      document.documentElement.dataset.ensoSession = activity(current);
      document.documentElement.dataset.ensoActivity = Object.values(state.conversations).some(
        (conversation) => conversation.status === 'running' || conversation.spawning
      )
        ? 'running'
        : Object.values(state.conversations).some((conversation) => conversation.error)
          ? 'error'
          : 'waiting';
    };
    update();
    const unsubscribe = useSessionsStore.subscribe(update);
    return () => {
      unsubscribe();
      delete document.documentElement.dataset.ensoSession;
      delete document.documentElement.dataset.ensoActivity;
    };
  }, []);
  return null;
}
