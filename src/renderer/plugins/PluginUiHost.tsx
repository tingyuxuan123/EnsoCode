import { useEffect } from 'react';
import { addSidePanelSubagent, openSidePanelPluginView } from '@/lib/sidePanelDock';
import { resolveSubagentTarget } from '@/lib/subagentTargets';
import { useSessionsStore } from '@/stores/sessions';
import { displayedConversationId } from '@/stores/sessions/chatChrome';
import { pluginCommandRefs, setPluginCommands } from './commands';
import { handleDraftRequest } from './draftBridge';
import { setPluginFileViewers } from './fileViewers';
import { createRendererDeps, loadPluginRenderer } from './loader';
import { disposePluginRenderer, rendererPluginKey, syncPluginRenderers } from './rendererReload';
import { handleSessionRequest, type SessionRequest } from './sessionBridge';
import { pluginStatusRefs, setPluginStatusItems } from './statusItems';
import { setPluginTriggers } from './triggers';
import { setPluginViews } from './viewBridge';

/** One host per window; generation checks revoke in-flight module initialization. */
export function PluginUiHost() {
  useEffect(() => {
    const api = window.electronAPI?.extensionPlugins;
    if (!api) return;
    const deps = createRendererDeps(() => displayedConversationId(useSessionsStore.getState()));
    let generation = 0;
    let mounted = true;
    const controller = new AbortController();
    const handles = new Map<string, { key: string; dispose(): void }>();
    const activeKeys = new Map<string, string>();
    let currentViews: { pluginId: string; id: string; title: string }[] = [];
    const clear = () => {
      controller.abort();
      activeKeys.clear();
      setPluginCommands([]);
      setPluginStatusItems([]);
      setPluginFileViewers([]);
      setPluginTriggers([]);
      setPluginViews([]);
      for (const [id, handle] of handles) disposePluginRenderer(id, handle);
      handles.clear();
    };
    const reload = () => {
      const mine = ++generation;
      void api
        .list()
        .then(async ({ plugins, registryError }) => {
          if (mine !== generation) return;
          const list = registryError ? [] : plugins;
          const enabled = list.filter((plugin) => plugin.state === 'enabled');
          activeKeys.clear();
          for (const plugin of enabled) activeKeys.set(plugin.id, rendererPluginKey(plugin));
          setPluginCommands(pluginCommandRefs(list));
          setPluginStatusItems(pluginStatusRefs(list));
          setPluginFileViewers(
            enabled.flatMap((plugin) =>
              (plugin.fileViewers ?? []).map((viewer) => ({
                build: plugin.build,
                pluginId: plugin.id,
                pluginName: plugin.name,
                ...viewer,
              }))
            )
          );
          currentViews = enabled.flatMap((plugin) =>
            plugin.views.map((view) => ({ pluginId: plugin.id, ...view }))
          );
          setPluginViews(
            enabled.flatMap((plugin) =>
              plugin.views.map((view) => ({
                build: plugin.build,
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
          await syncPluginRenderers(
            handles,
            list,
            async (source) => {
              const plugin = enabled.find((item) => item.id === source.id);
              if (!plugin) throw new Error('Plugin is disabled');
              return loadPluginRenderer(plugin.id, source.renderer, deps, {
                draft: plugin.permissions.includes('composer.draft'),
                tools: plugin.tools.map((tool) => tool.name),
                active: () => mounted && activeKeys.get(plugin.id) === rendererPluginKey(plugin),
                signal: controller.signal,
              });
            },
            () => mine === generation && mounted
          );
        })
        .catch((error) => console.warn('[plugin] list failed', error));
    };
    reload();
    const unsubscribe = api.onChanged(reload);
    const unsubscribeDraft = api.onDraftRequest((request) => {
      if (
        [
          'focusSession',
          'focusSubagent',
          'openChildRun',
          'createSession',
          'ensureSession',
          'openPluginView',
        ].includes(request.op)
      ) {
        void handleSessionRequest(request as SessionRequest, {
          conversation: (id) => useSessionsStore.getState().conversations[id] ?? null,
          focus: (rootId, target) => {
            const state = useSessionsStore.getState();
            state.selectConversation(rootId);
            if (target !== rootId) state.selectTab(rootId, target);
          },
          focusSubagent: (parentId, agentId) => {
            const target = resolveSubagentTarget(
              useSessionsStore.getState().conversations,
              parentId,
              agentId
            );
            if (!target) return false;
            addSidePanelSubagent(target);
            return true;
          },
          openChildRun: (parentId, childId) => {
            const child = useSessionsStore.getState().conversations[childId];
            if (child?.parentId !== parentId || !child.child) return false;
            addSidePanelSubagent({
              parentConversationId: parentId,
              childConversationId: childId,
              title: child.child.agentInstanceName,
            });
            return true;
          },
          create: async (projectId, presetId) => {
            const state = useSessionsStore.getState();
            const id = await state.newConversation(projectId, { forceNew: true });
            if (id && presetId) state.setPreset(id, presetId);
            return id;
          },
          prefill: (id, text) =>
            useSessionsStore.setState((state) => {
              const conversation = state.conversations[id];
              return conversation
                ? {
                    conversations: {
                      ...state.conversations,
                      [id]: { ...conversation, draftText: text },
                    },
                  }
                : state;
            }),
          ensure: async (id) => {
            const state = useSessionsStore.getState();
            if (!state.conversations[id]?.started) await state.resumeConversation(id);
            const after = useSessionsStore.getState().conversations[id];
            return after?.started || after?.spawning
              ? null
              : (after?.error ?? 'Unable to start session');
          },
          openPluginView: (sessionId, view) => {
            const known = currentViews.find(
              (item) => item.pluginId === view.pluginId && item.id === view.viewId
            );
            if (!known) return false;
            openSidePanelPluginView({ conversationId: sessionId, ...view, title: known.title });
            return true;
          },
        })
          .catch((error: unknown) => ({
            ok: false as const,
            code: 'SESSION_FAILED',
            error: error instanceof Error ? error.message : String(error),
          }))
          .then((result) => api.respondDraft({ requestId: request.requestId, ...result }));
      } else if (
        request.op === 'readDraft' ||
        request.op === 'insertText' ||
        request.op === 'replaceDraft'
      ) {
        void api.respondDraft({
          requestId: request.requestId,
          ...handleDraftRequest({ ...request, op: request.op }),
        });
      }
    });
    return () => {
      generation++;
      mounted = false;
      unsubscribe();
      unsubscribeDraft();
      clear();
    };
  }, []);
  return null;
}
