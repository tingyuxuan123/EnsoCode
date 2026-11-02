import { useEffect } from 'react';
import { useSessionsStore } from '@/stores/sessions';
import { useSettingsStore } from '@/stores/settings';
import { useDesignLocale } from './host/locale';
import { setDesignViewingSession } from './runtime';

/** Headless: P1 registers contributions only, no canvas/gallery mounts. */
export function DesignRuntimeHost() {
  const language = useSettingsStore((state) => state.language);
  useEffect(
    () => useDesignLocale.setState({ locale: language.startsWith('zh') ? 'zh' : 'en' }),
    [language]
  );
  const viewingSessionId = useSessionsStore((state) => {
    const parent = state.activeId;
    const child = parent ? state.conversations[parent]?.activeTabId : undefined;
    return child && state.conversations[child] ? child : parent;
  });
  useEffect(() => {
    void setDesignViewingSession(viewingSessionId).catch((error) =>
      console.warn('[design] runtime unavailable', error)
    );
  }, [viewingSessionId]);
  return null;
}
