import { useEffect } from 'react';
import { useSessionsStore } from '@/stores/sessions';
import { displayedConversationId } from '@/stores/sessions/chatChrome';
import { handleDraftRequest } from './draftBridge';
import { createRendererDeps, loadPluginRenderer } from './loader';
import { setPluginTriggers } from './triggers';
import { setPluginViews } from './viewBridge';

/** One host per window; generation checks revoke in-flight module initialization. */
export function PluginUiHost() {
  useEffect(() => {
    const api = window.electronAPI?.extensionPlugins;
    if (!api) return;
    const deps = createRendererDeps(() => displayedConversationId(useSessionsStore.getState()));
    let generation = 0;
    let controller = new AbortController();
    const handles: { dispose(): void }[] = [];
    const clear = () => {
      controller.abort();
      controller = new AbortController();
      setPluginTriggers([]);
      setPluginViews([]);
      for (const handle of handles.splice(0)) handle.dispose();
    };
    const reload = () => {
      const mine = ++generation;
      clear();
      void api
        .list()
        .then(async ({ plugins: list }) => {
          if (mine !== generation) return;
          const enabled = list.filter((plugin) => plugin.state === 'enabled');
          setPluginViews(
            enabled.flatMap((plugin) =>
              plugin.views.map((view) => ({
                pluginId: plugin.id,
                pluginName: plugin.name,
                ...view,
              }))
            )
          );
          setPluginTriggers(
            enabled.flatMap((plugin) =>
              plugin.triggers
                .filter((trigger) => trigger.symbol === '#')
                .map((trigger) => ({ pluginId: plugin.id, name: trigger.name }))
            )
          );
          for (const plugin of enabled) {
            if (!plugin.renderer) continue;
            try {
              const handle = await loadPluginRenderer(plugin.id, plugin.renderer, deps, {
                draft: plugin.permissions.includes('composer.draft'),
                tools: plugin.tools.map((tool) => tool.name),
                active: () => mine === generation,
                signal: controller.signal,
              });
              if (mine !== generation) {
                handle.dispose();
                return;
              }
              handles.push(handle);
            } catch (error) {
              if (mine === generation) console.warn(`[plugin] ${plugin.id} renderer failed`, error);
            }
          }
        })
        .catch((error) => console.warn('[plugin] list failed', error));
    };
    reload();
    const unsubscribe = api.onChanged(reload);
    const unsubscribeDraft = api.onDraftRequest((request) => {
      void api.respondDraft({ requestId: request.requestId, ...handleDraftRequest(request) });
    });
    return () => {
      generation++;
      unsubscribe();
      unsubscribeDraft();
      clear();
    };
  }, []);
  return null;
}
