import { useEffect } from 'react';
import { useBotModeActive } from '@/stores/bots/mode';
import { useSessionsStore } from '@/stores/sessions';
import { useSettingsStore } from '@/stores/settings';
import { viewedDesignSessionId } from './host/activity-route';
import { emitDesignConversation, syncDesignConversationActivity } from './host/context';
import { useDesignLocale } from './host/locale';
import { createMainDesignHost } from './host/main-host';
import { createDesignToolActivity } from './host/tool-activity';
import { setDesignViewingSession } from './runtime';
import './vetta/src/style.css';

const mainHost = createMainDesignHost();

/** The runtime stays alive independently of canvas mounts. */
export function DesignRuntimeHost() {
  const language = useSettingsStore((state) => state.language);
  useEffect(
    () => useDesignLocale.setState({ locale: language.startsWith('zh') ? 'zh' : 'en' }),
    [language]
  );
  const botMode = useBotModeActive();
  const viewingSessionId = useSessionsStore((state) =>
    botMode ? null : viewedDesignSessionId(state.conversations, state.activeId)
  );
  useEffect(() => {
    const streaming = viewingSessionId
      ? useSessionsStore.getState().conversations[viewingSessionId]?.status === 'running'
      : false;
    void setDesignViewingSession(viewingSessionId, mainHost, streaming).catch((error) =>
      console.warn('[design] runtime unavailable', error)
    );
  }, [viewingSessionId]);
  const streaming = useSessionsStore((state) =>
    Boolean(viewingSessionId && state.conversations[viewingSessionId]?.status === 'running')
  );
  useEffect(
    () => syncDesignConversationActivity(viewingSessionId, streaming),
    [viewingSessionId, streaming]
  );
  // 工具调用 → 画布帧的「浏览中 / 修改中 / 创作中 / 已更新」。
  useEffect(() => {
    const tracker = createDesignToolActivity();
    const sync = () => {
      const conversation = viewingSessionId
        ? useSessionsStore.getState().conversations[viewingSessionId]
        : undefined;
      for (const event of tracker.sync(
        viewingSessionId,
        conversation?.messages ?? [],
        conversation?.status === 'running'
      ))
        emitDesignConversation(event);
    };
    sync();
    return useSessionsStore.subscribe((state, previous) => {
      if (!viewingSessionId) return;
      if (state.conversations[viewingSessionId] === previous.conversations[viewingSessionId])
        return;
      sync();
    });
  }, [viewingSessionId]);
  return null;
}
