import { useEffect } from 'react';
import { useSessionsStore } from '@/stores/sessions';
import { useSettingsStore } from '@/stores/settings';
import { viewedDesignSessionId } from './host/activity-route';
import { syncDesignConversationActivity } from './host/context';
import { useDesignLocale } from './host/locale';
import { setDesignViewingSession } from './runtime';
import './vetta/src/style.css';

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
  useEffect(() => {
    void setDesignViewingSession(viewingSessionId).catch((error) =>
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
  return null;
}
