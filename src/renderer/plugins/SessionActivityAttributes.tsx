import { useEffect } from 'react';
import { useSessionsStore } from '@/stores/sessions';
import { displayedConversationId } from '@/stores/sessions/chatChrome';

/**
 * 主题素材槽的会话状态（`data-enso-session` / `data-enso-activity`）。
 *
 * 只有主窗口既有会话状态又有 `data-enso` 挂点；第二个窗口导入 sessions store 会从
 * settings.json 水合出过期快照并在 setState 时写回，所以这段订阅必须留在主窗口，
 * 不能跟着 `PluginThemeHost` 扩散到其它入口。
 */
export function SessionActivityAttributes() {
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
