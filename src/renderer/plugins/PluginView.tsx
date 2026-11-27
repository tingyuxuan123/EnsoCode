import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/i18n';
import { inlinePluginViewHtml } from './inlineAssets';
import { observePluginTheme, readPluginTheme } from './themeBridge';
import { hasActivePluginGesture, hasPluginViewGesture } from './userGesture';
import {
  createViewBridge,
  decodeUtf8Base64,
  usePluginViews,
  viewEventPush,
  viewFileEdit,
  viewFilePush,
  viewStoragePatch,
  viewThemePush,
} from './viewBridge';
import { createWorkspaceBridge } from './workspaceBridge';

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
  if (!view)
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        {t('Plugin is not enabled')}
      </div>
    );
  return (
    <PluginFrame
      key={`${pluginId}:${view.id}:${view.build ?? ''}`}
      pluginId={pluginId}
      entry={view.entry}
      title={view.title}
      sessionId={sessionId}
    />
  );
}
export interface PluginFrameFile {
  rel: string;
  text: string;
  onEdit(text: string): void;
}
export function PluginFrame({
  pluginId,
  entry,
  title,
  sessionId,
  file,
}: {
  pluginId: string;
  entry: string;
  title: string;
  sessionId: string | null;
  file?: PluginFrameFile;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const fileRef = useRef(file);
  fileRef.current = file;
  const channelRef = useRef<MessageChannel | null>(null);
  const sessionRef = useRef(sessionId);
  // A frame stays bound to its originating session until explicitly selecting a project.
  // A background active-chat change cannot redirect its pending editor or later save.
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || !entry) return;
    setError(null);
    let disposed = false;
    const nonce = crypto.randomUUID();
    const channel = new MessageChannel();
    channelRef.current = channel;
    const stopTheme = observePluginTheme(document, (snapshot) =>
      channel.port1.postMessage(viewThemePush(snapshot.theme, snapshot.variables))
    );
    const unsubscribe = window.electronAPI.extensionPlugins.onViewEvent?.((event) => {
      if (!disposed && event.pluginId === pluginId)
        channel.port1.postMessage(viewEventPush(event.name, event.data));
    });
    const workspace = createWorkspaceBridge({
      list: async () => {
        const result = await window.electronAPI.extensionPlugins.workspaceProjects(
          pluginId,
          sessionRef.current
        );
        if (!result.ok) throw new Error(result.error);
        return result;
      },
      call: async (method, args, gesture, selected) => {
        if (disposed) throw new Error('Plugin view closed');
        const result = await window.electronAPI.extensionPlugins.call({
          pluginId,
          method: 'renderer.call',
          payload: { method, args },
          sessionId: selected === undefined ? sessionRef.current : null,
          ...(selected !== undefined ? { workspace: selected } : {}),
          gesture,
        });
        if (!result.ok) throw new Error(result.error);
        return result.value;
      },
    });
    const handle = createViewBridge(workspace, () =>
      hasPluginViewGesture(frame, document.activeElement, hasActivePluginGesture())
    );
    channel.port1.onmessage = (event) => {
      if (disposed) return;
      const patch = viewStoragePatch(event.data);
      if (patch) {
        void window.electronAPI.extensionPlugins.viewStateSet(pluginId, patch);
        return;
      }
      const edit = viewFileEdit(event.data);
      if (edit !== null) {
        fileRef.current?.onEdit(edit);
        return;
      }
      if (!disposed)
        void handle(event.data).then((reply) => {
          if (reply && !disposed) channel.port1.postMessage(reply);
        });
    };
    const onLoad = async () => {
      try {
        const [result, state] = await Promise.all([
          window.electronAPI.extensionPlugins.asset(pluginId, entry),
          window.electronAPI.extensionPlugins.viewStateGet(pluginId),
        ]);
        if (disposed) return;
        if (!result.ok) {
          setError(result.error);
          return;
        }
        const html = await inlinePluginViewHtml(
          decodeUtf8Base64(result.base64),
          entry,
          async (rel) => {
            const asset = await window.electronAPI.extensionPlugins.asset(pluginId, rel);
            return asset.ok ? asset : null;
          }
        );
        if (disposed) return;
        const appearance = readPluginTheme(document);
        frame.contentWindow?.postMessage(
          {
            type: 'enso-view-init',
            nonce,
            html,
            storage: state.ok ? state.state : {},
            ...(fileRef.current
              ? { file: { rel: fileRef.current.rel, text: fileRef.current.text } }
              : {}),
            theme: appearance.theme,
            themeVariables: appearance.variables,
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
      stopTheme();
      unsubscribe?.();
      channelRef.current = null;
      frame.removeEventListener('load', onLoad);
      channel.port1.onmessage = null;
      channel.port1.close();
      channel.port2.close();
      frame.removeAttribute('src');
    };
  }, [pluginId, entry]);
  useEffect(() => {
    if (file) channelRef.current?.port1.postMessage(viewFilePush(file.rel, file.text));
  }, [file]);
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
        title={title}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        className="min-h-0 w-full flex-1 border-0 bg-background"
      />
    </div>
  );
}
