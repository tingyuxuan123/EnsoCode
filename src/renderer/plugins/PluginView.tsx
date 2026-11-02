import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/i18n';
import { hasActivePluginGesture, hasPluginViewGesture } from './userGesture';
import { createViewBridge, decodeUtf8Base64, usePluginViews } from './viewBridge';

export function PluginView({
  pluginId,
  viewId,
  sessionId,
}: {
  pluginId: string;
  viewId: string;
  sessionId: string | null;
}) {
  const { t } = useI18n();
  const view = usePluginViews().find((item) => item.pluginId === pluginId && item.id === viewId);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const sessionRef = useRef(sessionId);
  sessionRef.current = sessionId;
  const [error, setError] = useState<string | null>(null);
  const entry = view?.entry;
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || !entry) return;
    setError(null);
    let disposed = false;
    const nonce = crypto.randomUUID();
    const channel = new MessageChannel();
    const handle = createViewBridge(
      async (method, args, gesture) => {
        if (disposed) throw new Error('Plugin view closed');
        const result = await window.electronAPI.extensionPlugins.call({
          pluginId,
          method: 'renderer.call',
          payload: { method, args },
          sessionId: sessionRef.current,
          gesture,
        });
        if (!result.ok) throw new Error(result.error);
        return result.value;
      },
      () => hasPluginViewGesture(frame, document.activeElement, hasActivePluginGesture())
    );
    channel.port1.onmessage = (event) => {
      if (!disposed)
        void handle(event.data).then((reply) => {
          if (reply && !disposed) channel.port1.postMessage(reply);
        });
    };
    const onLoad = async () => {
      try {
        const result = await window.electronAPI.extensionPlugins.asset(pluginId, entry);
        if (disposed) return;
        if (!result.ok) {
          setError(result.error);
          return;
        }
        frame.contentWindow?.postMessage(
          {
            type: 'enso-view-init',
            nonce,
            html: decodeUtf8Base64(result.base64),
            theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
          },
          '*',
          [channel.port2]
        );
      } catch (reason) {
        if (!disposed) setError(String(reason));
      }
    };
    frame.addEventListener('load', onLoad, { once: true });
    const url = new URL('plugin-view.html', document.baseURI);
    url.hash = nonce;
    frame.src = url.href;
    return () => {
      disposed = true;
      frame.removeEventListener('load', onLoad);
      channel.port1.onmessage = null;
      channel.port1.close();
      channel.port2.close();
      frame.removeAttribute('src');
    };
  }, [pluginId, entry]);
  if (!view)
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        {t('Plugin is not enabled')}
      </div>
    );
  return (
    <div className="flex h-full min-h-0 flex-col">
      {error && (
        <p role="alert" className="px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}
      <iframe
        ref={frameRef}
        name="enso-plugin-view"
        title={view.title}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        className="min-h-0 w-full flex-1 border-0 bg-background"
      />
    </div>
  );
}
