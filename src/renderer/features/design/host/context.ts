import type { DesignResult, DesignRootRef } from '@shared/types/design';
import { addToast } from '@/components/ui/toast';
import { useSettingsStore } from '@/stores/settings';
import type { ConversationEvent, ConversationState } from '../vetta/sdk/conversation';
import type { PluginFsApi } from '../vetta/sdk/fs';
import type { PluginNetworkResponse } from '../vetta/sdk/network';
import { setDesignViewingCwd } from './canvas-target';
import { captureDesign, designEngineRoute, releaseDesignCapture } from './engine';
import { designPaths, resolveDesignRoot } from './paths';
import { createGalleryProject, listGalleryProjects, setGalleryProjectArchived } from './projects';
import {
  designHooks,
  designPromptProviders,
  designTools,
  registerContribution,
  registerInMap,
  updateDesignUi,
} from './registry';
import { translate } from './translation';
import type { PluginContext } from './types';

export function unsupported(api: string): never {
  throw new Error(`小满 design host: ${api} is not supported in P1`);
}
/** All unimplemented SDK members fail explicitly (never expose a generic IPC). */
function subset<T extends object>(name: string, members: Partial<T>): T {
  return new Proxy(members as T, {
    get(target, key, receiver) {
      return Reflect.has(target, key)
        ? Reflect.get(target, key, receiver)
        : () => unsupported(`${name}.${String(key)}`);
    },
  });
}
export function unwrap<T extends object>(result: DesignResult<T>): T & { ok: true } {
  if (!result.ok) throw new Error(result.error);
  return result;
}
const api = () => window.electronAPI.design;
const conversationListeners = new Set<(event: ConversationEvent) => void>();
let currentConversation: ConversationState = {
  id: null,
  cwd: null,
  sessionPath: null,
  model: null,
  isStreaming: false,
};
export function emitDesignConversation(event: ConversationEvent): void {
  if (event.type === 'conversation-changed') {
    currentConversation = event.conversation;
    setDesignViewingCwd(event.conversation.cwd);
  }
  if (event.type === 'turn-start' || event.type === 'turn-end')
    currentConversation = { ...currentConversation, isStreaming: event.type === 'turn-start' };
  for (const listener of conversationListeners) listener(event);
}

export function syncDesignConversationActivity(id: string | null, streaming: boolean): void {
  if (currentConversation.id !== id || currentConversation.isStreaming === streaming) return;
  emitDesignConversation(
    streaming ? { type: 'turn-start' } : { type: 'turn-end', stopReason: 'stop' }
  );
}

export async function prepareDesignRoots(refs: DesignRootRef[]): Promise<void> {
  await Promise.all(refs.map(resolveDesignRoot));
}

/** 当前设计会话（conversation-changed 最近一次的快照）。 */
export function currentDesignConversation(): ConversationState {
  return currentConversation;
}

type HostUi = Pick<
  PluginContext['ui'],
  | 'openActivityTab'
  | 'setActivityTabVisible'
  | 'setActivityPanelWidth'
  | 'openWorkspaceView'
  | 'setPromptAttachment'
>;
type HostConversation = Pick<
  PluginContext['conversation'],
  'sendPrompt' | 'createSession' | 'insertText'
>;

/**
 * 依赖具体窗口的 SDK 能力由宿主注入：主窗口用会话 / 侧栏 / Composer（main-host），
 * 独立设计窗口只转发派活。本文件不得导入 sessions、sidePanel 等主窗口 store。
 * 未提供的能力调用时显式报不支持。
 */
export interface DesignContextHost {
  /** openActivityTab / setActivityPanelWidth 在核心登记状态之后调用；其余整体替换。 */
  ui?: Partial<HostUi>;
  conversation?: Partial<HostConversation>;
  sessions?: Partial<PluginContext['official']['sessions']>;
  navigation?: Partial<PluginContext['official']['navigation']>;
}

export function createDesignContext(host?: DesignContextHost): PluginContext {
  const fs: PluginFsApi = {
    async readDir(path) {
      const mapped = designPaths.map(path);
      const result = unwrap(await api().fs({ op: 'readDir', ...mapped }));
      if (!('entries' in result)) throw new Error('Missing directory entries');
      return result.entries.map((entry) => ({
        ...entry,
        path: `${path.replace(/\/$/, '')}/${entry.name}`,
      }));
    },
    async readFile(path) {
      const result = unwrap(await api().fs({ op: 'readFile', ...designPaths.map(path) }));
      if (!('content' in result)) throw new Error('Missing file content');
      return { content: result.content, encoding: result.encoding };
    },
    async readBinaryFile(path) {
      const result = unwrap(await api().fs({ op: 'readBinaryFile', ...designPaths.map(path) }));
      if (!('data' in result)) throw new Error('Missing binary file content');
      return result;
    },
    async writeFile(path, content, encoding = 'utf8') {
      unwrap(await api().fs({ op: 'writeFile', ...designPaths.map(path), content, encoding }));
    },
    async stat(path) {
      const result = unwrap(await api().fs({ op: 'stat', ...designPaths.map(path) }));
      if (!('stat' in result)) throw new Error('Missing file stat');
      return result.stat;
    },
    async rename(from, to) {
      const a = designPaths.map(from);
      const b = designPaths.map(to);
      if (JSON.stringify(a.root) !== JSON.stringify(b.root))
        throw new Error('Cross-root design rename is not supported');
      unwrap(await api().fs({ op: 'rename', root: a.root, from: a.rel, to: b.rel }));
    },
    async delete(path) {
      unwrap(await api().fs({ op: 'delete', ...designPaths.map(path) }));
    },
    async move() {
      unsupported('fs.move');
    },
    async createDirectory(path) {
      unwrap(await api().fs({ op: 'createDirectory', ...designPaths.map(path) }));
    },
    async listFilesRecursive(path, options) {
      const mapped = designPaths.map(path);
      const result = unwrap(
        await api().fs({
          op: 'listFilesRecursive',
          ...mapped,
          names: options?.names ? [...options.names] : undefined,
          ignoredDirectories: options?.ignoredDirectories
            ? [...options.ignoredDirectories]
            : undefined,
        })
      );
      if (!('files' in result)) throw new Error('Missing recursive file list');
      // Contract rel is relative to the authoritative root; SDK relPath is relative to the scan.
      const base = path.replace(/\/$/, '');
      return result.files.map((file) => ({
        name: file.name,
        path: `${base}/${mapped.rel ? file.rel.slice(mapped.rel.length + 1) : file.rel}`,
        relPath: mapped.rel ? file.rel.slice(mapped.rel.length + 1) : file.rel,
      }));
    },
    async saveAs(defaultFileName, content, encoding = 'utf8', options) {
      return unwrap(await api().saveAs({ defaultFileName, content, encoding, ...options })).path;
    },
    watchDirectory(path, listener) {
      const mapped = designPaths.map(path);
      let disposed = false;
      let watchId: string | undefined;
      const unsubscribe = api().onWatchEvent((event) => {
        if (!disposed && event.watchId === watchId) listener(path);
      });
      void api()
        .watch(mapped)
        .then((result) => {
          watchId = unwrap(result).watchId;
          if (disposed) void api().unwatch(watchId);
        })
        .catch((error) => console.warn('[design] watch failed', error));
      return {
        dispose() {
          disposed = true;
          unsubscribe();
          if (watchId) void api().unwatch(watchId);
        },
      };
    },
  };
  const storage: PluginContext['storage'] = subset<PluginContext['storage']>('storage', {
    async list(prefix) {
      const r = unwrap(await api().storage({ op: 'list', prefix }));
      if (!('paths' in r)) throw new Error('Missing storage paths');
      return r.paths;
    },
    async readFile(path, encoding) {
      const r = unwrap(await api().storage({ op: 'readFile', path, encoding }));
      if (!('data' in r)) throw new Error('Missing storage data');
      return r.data;
    },
    async writeFile(path, data, encoding) {
      return storage.commit([{ type: 'write', path, data, encoding }]);
    },
    async commit(changes, options) {
      const r = unwrap(
        await api().storage({
          op: 'commit',
          changes: [...changes],
          expectedRevision: options?.expectedRevision,
        })
      );
      if (!('changedPaths' in r)) throw new Error('Missing storage revision');
      return r;
    },
    async readSnapshot(paths, encoding) {
      const r = unwrap(await api().storage({ op: 'readSnapshot', paths: [...paths], encoding }));
      if (!('files' in r)) throw new Error('Missing storage snapshot');
      return r;
    },
  });
  const ui: PluginContext['ui'] = subset<PluginContext['ui']>('ui', {
    registerActivityTab: (value) => registerContribution('activity-tab', value),
    registerGlobalSlot: (value) => registerContribution('global', value),
    registerNewSessionContext: (value) => registerContribution('new-session-context', value),
    registerWorkspaceView: (value) => registerContribution('workspace-view', value),
    registerFilePreview: (value) => registerContribution('file-preview', value),
    registerCardRenderer: (value) => registerContribution('card-renderer', value),
    registerShortcutScope: (value) => registerContribution('shortcut', value),
    registerAbilityDetailSlot: (value) => registerContribution('ability-detail', value),
    registerBottomPanel: (value) => registerContribution('bottom-panel', value),
    registerInputAction: (value) => registerContribution('input-action', value),
    registerToolCallSlot: (value) => registerContribution('tool-call', value),
    registerTurnCard: (value) => registerContribution('turn-card', value),
    openActivityTab: (id, options) => {
      updateDesignUi(`activity:${options?.cwd ?? currentConversation.cwd}:${id}`, {
        open: true,
        ...options,
      });
      host?.ui?.openActivityTab?.(id, options);
    },
    setActivityTabVisible:
      host?.ui?.setActivityTabVisible ??
      ((id, visible, options) =>
        updateDesignUi(`visible:${options?.cwd ?? currentConversation.cwd}:${id}`, visible)),
    setActivityPanelWidth: (width) => {
      updateDesignUi('panelWidth', width);
      host?.ui?.setActivityPanelWidth?.(width);
    },
    ...(host?.ui?.openWorkspaceView ? { openWorkspaceView: host.ui.openWorkspaceView } : {}),
    setWorkspaceViewHeader: (id, header) => updateDesignUi(`header:${id}`, header),
    setWorkspaceViewBadge: (id, badge) => updateDesignUi(`badge:${id}`, badge),
    ...(host?.ui?.setPromptAttachment ? { setPromptAttachment: host.ui.setPromptAttachment } : {}),
    previewImage: (ref, group) => updateDesignUi('imagePreview', { ref, group }),
    previewFile: (file, group) => updateDesignUi('filePreview', { file, group }),
    notify: (options) => {
      updateDesignUi('notification', options);
      addToast({
        title: options.title ?? translate('tab.label'),
        description: options.message,
        type: options.variant ?? (options.error ? 'error' : 'info'),
        timeout: options.durationMs ?? (options.error ? 0 : undefined),
      });
      if (options.error) console.warn('[design]', options.error);
    },
    async openExternal(url) {
      const target = new URL(url);
      unwrap(
        await api().shell(
          target.protocol === 'http:'
            ? { op: 'openEngineRoute', ...designEngineRoute(target) }
            : { op: 'openExternal', url }
        )
      );
    },
    async copyImage(dataUrl) {
      const blob = await (await fetch(dataUrl)).blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    },
    getSidebarState: () => ({ collapsed: false, narrow: false, visible: true }),
  });
  const conversation: PluginContext['conversation'] = {
    on(listener) {
      conversationListeners.add(listener);
      queueMicrotask(() => {
        if (conversationListeners.has(listener))
          listener({ type: 'conversation-changed', conversation: currentConversation });
      });
      return {
        dispose: () => {
          conversationListeners.delete(listener);
        },
      };
    },
    sendPrompt: (text, canvas) =>
      host?.conversation?.sendPrompt
        ? host.conversation.sendPrompt(text, canvas)
        : unsupported('conversation.sendPrompt'),
    createSession: (cwd, options) =>
      host?.conversation?.createSession
        ? host.conversation.createSession(cwd, options)
        : unsupported('conversation.createSession'),
    insertText: (text) =>
      host?.conversation?.insertText
        ? host.conversation.insertText(text)
        : unsupported('conversation.insertText'),
    async abort() {
      unsupported('conversation.abort');
    },
  };
  return {
    plugin: { id: 'vetta-ui-design', version: '0.7.6' },
    fs,
    storage,
    ui,
    conversation,
    agent: subset<PluginContext['agent']>('agent', {
      registerTool: (value) => registerInMap(designTools, value.name ?? value.id, value),
      registerHook: (value) => registerInMap(designHooks, value.id, value),
      registerSystemPromptProvider: (value) =>
        registerInMap(designPromptProviders, value.id, value),
    }),
    fileExplorer: subset<PluginContext['fileExplorer']>('fileExplorer', {
      registerContextMenuAction: (value) => registerContribution('file-context-menu', value),
      registerDecorationProvider: (value) => registerContribution('file-decoration', value),
    }),
    command: {
      async run() {
        return unsupported('command.run (use the fixed design.engine/design.script APIs)');
      },
      async spawn() {
        return unsupported('command.spawn (use design.engine)');
      },
    },
    capture: { offscreen: captureDesign, releaseOffscreen: releaseDesignCapture },
    network: {
      async request<T>(
        request: Parameters<PluginContext['network']['request']>[0]
      ): Promise<PluginNetworkResponse<T>> {
        if (request.method && request.method !== 'GET' && request.method !== 'POST')
          unsupported(`network.${request.method}`);
        if (request.body?.type === 'multipart') unsupported('network.multipart');
        const result = unwrap(
          await api().network({
            ...request,
            method: request.method as 'GET' | 'POST' | undefined,
            body: request.body?.type === 'json' ? request.body : undefined,
          })
        );
        return {
          ...result,
          ok: result.status >= 200 && result.status < 300,
          body: result.body as T,
        };
      },
    },
    official: subset<PluginContext['official']>('official', {
      dialog: subset<PluginContext['official']['dialog']>('official.dialog', {
        async openFiles(options = {}) {
          const result = unwrap(await api().openFiles(options));
          return result.files;
        },
      }),
      projects: subset<PluginContext['official']['projects']>('official.projects', {
        list: listGalleryProjects,
        async create(name, customPath) {
          if (customPath !== undefined)
            throw new Error('Custom design workspace paths are not supported');
          return createGalleryProject(name);
        },
        archive: (cwd) => setGalleryProjectArchived(cwd, true),
        unarchive: (cwd) => setGalleryProjectArchived(cwd, false),
      }),
      sessions: subset<PluginContext['official']['sessions']>('official.sessions', {
        ...host?.sessions,
      }),
      shell: {
        async showItemInFolder(path) {
          unwrap(await api().shell({ op: 'showItemInFolder', ...designPaths.map(path) }));
        },
      },
      navigation: subset<PluginContext['official']['navigation']>('official.navigation', {
        ...host?.navigation,
      }),
    }),
    i18n: {
      get locale() {
        return useSettingsStore.getState().language.startsWith('zh') ? 'zh' : 'en';
      },
      t: translate,
      onChange(listener) {
        return {
          dispose: useSettingsStore.subscribe((state, previous) => {
            if (state.language !== previous.language) listener(state.language);
          }),
        };
      },
    },
    getAgentMode: () => 'code',
    onAgentModeChanged: () => ({ dispose() {} }),
  };
}
