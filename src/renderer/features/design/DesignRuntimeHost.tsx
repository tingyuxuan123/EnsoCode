import { useEffect, useState } from 'react';
import { useSessionsStore } from '@/stores/sessions';
import { useSettingsStore } from '@/stores/settings';
import { viewedDesignSessionId } from './host/activity-route';
import { emitDesignConversation, syncDesignConversationActivity } from './host/context';
import { useDesignLocale } from './host/locale';
import { createMainDesignHost } from './host/main-host';
import { createDesignToolActivity } from './host/tool-activity';
import { setDesignViewingSession } from './runtime';
import { onCanvasController } from './vetta/src/canvas/design-runtime';
import './vetta/src/style.css';

const mainHost = createMainDesignHost();

/** The runtime stays alive independently of canvas mounts. */
export function DesignRuntimeHost() {
  const language = useSettingsStore((state) => state.language);
  useEffect(
    () => useDesignLocale.setState({ locale: language.startsWith('zh') ? 'zh' : 'en' }),
    [language]
  );
  const viewingSessionId = useSessionsStore((state) =>
    viewedDesignSessionId(state.conversations, state.activeId)
  );
  const [boundSession, setBoundSession] = useState<{ id: string | null } | null>(null);
  useEffect(() => {
    let disposed = false;
    setBoundSession(null);
    const streaming = viewingSessionId
      ? useSessionsStore.getState().conversations[viewingSessionId]?.status === 'running'
      : false;
    void setDesignViewingSession(viewingSessionId, mainHost, streaming)
      .then(() => {
        if (disposed) return;
        const running = Boolean(
          viewingSessionId &&
            useSessionsStore.getState().conversations[viewingSessionId]?.status === 'running'
        );
        syncDesignConversationActivity(viewingSessionId, running);
        setBoundSession({ id: viewingSessionId });
      })
      .catch((error) => console.warn('[design] runtime unavailable', error));
    return () => {
      disposed = true;
    };
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
    if (!boundSession || boundSession.id !== viewingSessionId) return;
    let tracker = createDesignToolActivity();
    const sync = () => {
      const conversation = viewingSessionId
        ? useSessionsStore.getState().conversations[viewingSessionId]
        : undefined;
      for (const event of tracker.sync(
        viewingSessionId,
        conversation?.messages ?? [],
        conversation?.status === 'running',
        Object.values(conversation?.designToolActivity ?? {})
      ))
        emitDesignConversation(event);
    };
    const stopCanvas = onCanvasController((controller) => {
      if (!controller) return;
      tracker = createDesignToolActivity();
      sync();
    });
    const stopStore = useSessionsStore.subscribe((state, previous) => {
      if (!viewingSessionId) return;
      if (state.conversations[viewingSessionId] === previous.conversations[viewingSessionId])
        return;
      sync();
    });
    return () => {
      stopCanvas();
      stopStore();
    };
  }, [viewingSessionId, boundSession]);
  return null;
}
