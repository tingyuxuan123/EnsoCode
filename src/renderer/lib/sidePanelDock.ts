import { parseMarkdownHttpUrl } from '@shared/markdownLinks';
import {
  isWorkflowAvailable,
  projectDisabledBuiltinTools,
  resolveDisabledBuiltinTools,
} from '@shared/types/builtinTools';
import type { DockviewApi, DockviewPanelApi } from 'dockview-react';
import { releaseTerminal } from '@/lib/terminalRegistry';
import { useSessionsStore } from '@/stores/sessions';
import { useSettingsStore } from '@/stores/settings';
import type { SettingsState } from '@/stores/settings/types';
import { useSidePanelStore } from '@/stores/sidePanel';
import {
  FILE_CITATION_PANEL,
  isFileCitationPanel,
  isSubagentPanel,
} from '@/stores/sidePanel/transientPanels';
import { resolveSidePanelDockConversationId } from './sidePanelDockId';
import { resolveSubagentTarget } from './subagentTargets';

const docks = new Map<string, DockviewApi>();
const filesTabClosers = new Map<string, () => boolean>();
type FileTarget = [rel: string, line?: number, viewer?: 'text' | 'markdown'];
const filesOpeners = new Map<string, (...target: FileTarget) => void>();
/** Files 视图未挂载时挂起的待开文件，视图注册 opener 时补开 */
const pendingFileOpens = new Map<string, FileTarget>();
/** dock 未挂载时挂起的 Files 面板，dock 绑定后补建 */
const pendingFilesReveal = new Set<string>();
export interface FileCitationPreview {
  path: string;
  content: string;
  line?: number;
  revision?: string;
}
export interface FileCitationPanelParams extends FileCitationPreview {
  conversationId: string;
  projectId: string;
  citationId: string;
}
const pendingFileCitations = new Map<string, Map<string, FileCitationPreview>>();
const citationClosers = new WeakMap<DockviewPanelApi, () => void>();

export function registerFileCitationCloser(panel: DockviewPanelApi, close: () => void): () => void {
  citationClosers.set(panel, close);
  return () => {
    citationClosers.delete(panel);
  };
}

export function requestSidePanelTabClose(panel: DockviewPanelApi): void {
  const close = citationClosers.get(panel);
  if (close) close();
  else panel.close();
}
type DesignReveal = { conversationId: string; title?: string; width?: number | 'max' };
const pendingDesignReveal = new Map<string, DesignReveal>();
const pendingMobileDevices = new Set<string>();
type PluginViewReveal = { conversationId: string; pluginId: string; viewId: string; title: string };
const pendingPluginViews = new Map<string, Map<string, PluginViewReveal>>();
const pendingBrowserReveal: {
  conversationId: string;
  tabId?: string;
  ownerId?: string;
  background?: boolean;
}[] = [];
const pendingWorkflowReveal: {
  conversationId: string;
  ownerId: string;
  title: string;
  runId: string;
}[] = [];
const revealedWorkflowRuns = new Set<string>();
type SubagentReveal = {
  parentConversationId: string;
  childConversationId?: string;
  title?: string;
};
const pendingSubagentReveal = new Map<string, Map<string, SubagentReveal>>();

/** 工作流 tab 跟随该项目生效的内置工具开关（项目覆盖优先于全局） */
export function selectWorkflowAvailable(
  state: Pick<SettingsState, 'disabledBuiltinTools' | 'projects'>,
  projectId: string | undefined
): boolean {
  return isWorkflowAvailable(
    resolveDisabledBuiltinTools(state.disabledBuiltinTools, {
      disabledBuiltinTools: projectDisabledBuiltinTools(state.projects, projectId),
    })
  );
}

export function registerFilesTabCloser(conversationId: string, close: () => boolean): () => void {
  filesTabClosers.set(conversationId, close);
  return () => {
    if (filesTabClosers.get(conversationId) === close) filesTabClosers.delete(conversationId);
  };
}

/**
 * 注册按会话归属的 Files 打开入口；冷挂载时保留行号与查看器意图并只消费一次。
 *
 * Register the conversation-owned Files opener; retain line and viewer intent across cold mounts and consume it once.
 */
export function registerFilesOpener(
  conversationId: string,
  open: (...target: FileTarget) => void
): () => void {
  filesOpeners.set(conversationId, open);
  const pending = pendingFileOpens.get(conversationId);
  if (pending !== undefined) {
    pendingFileOpens.delete(conversationId);
    open(...pending);
  }
  return () => {
    if (filesOpeners.get(conversationId) === open) filesOpeners.delete(conversationId);
  };
}

export function bindSidePanelDock(conversationId: string, api: DockviewApi): void {
  docks.set(conversationId, api);
  // onReady restores the saved layout synchronously; reveal only after fromJSON completes.
  queueMicrotask(() => {
    if (docks.get(conversationId) !== api) return;
    const citations = pendingFileCitations.get(conversationId);
    pendingFileCitations.delete(conversationId);
    for (const [citationId, file] of citations ?? []) {
      openSidePanelFileCitation(conversationId, citationId, file);
    }
    if (pendingMobileDevices.delete(conversationId)) addSidePanelMobileDevices(conversationId);
    const design = pendingDesignReveal.get(conversationId);
    const pluginViews = pendingPluginViews.get(conversationId);
    pendingPluginViews.delete(conversationId);
    for (const view of pluginViews?.values() ?? []) openSidePanelPluginView(view);
    if (design) {
      pendingDesignReveal.delete(conversationId);
      addSidePanelDesign(design);
    }
    const pending = pendingSubagentReveal.get(conversationId);
    pendingSubagentReveal.delete(conversationId);
    for (const item of pending?.values() ?? []) {
      if (item.childConversationId) {
        addSidePanelSubagent({ ...item, childConversationId: item.childConversationId });
      } else addSidePanelSubagentDirectory(item.parentConversationId);
    }
    const due = pendingBrowserReveal.filter((item) => item.conversationId === conversationId);
    pendingBrowserReveal.splice(
      0,
      pendingBrowserReveal.length,
      ...pendingBrowserReveal.filter((item) => item.conversationId !== conversationId)
    );
    for (const item of due) {
      addSidePanelBrowser({
        conversationId: item.ownerId ?? item.conversationId,
        tabId: item.tabId,
        background: item.background,
      });
    }
  });
  if (pendingFilesReveal.delete(conversationId)) {
    // 等 onReady 里的布局恢复完再建，免得被 fromJSON 覆盖
    queueMicrotask(() => {
      const projectId = useSessionsStore.getState().conversations[conversationId]?.projectId;
      if (projectId && docks.get(conversationId) === api) {
        revealFilesPanel(api, conversationId, projectId);
      }
    });
  }
  const workflowDue = pendingWorkflowReveal.filter(
    (item) => item.conversationId === conversationId
  );
  pendingWorkflowReveal.splice(
    0,
    pendingWorkflowReveal.length,
    ...pendingWorkflowReveal.filter((item) => item.conversationId !== conversationId)
  );
  for (const item of workflowDue) {
    addSidePanelWorkflow({
      conversationId: item.ownerId,
      runId: item.runId,
      title: item.title,
    });
  }
}

function activeDock(): { api: DockviewApi; conversationId: string; projectId: string } | null {
  const sessions = useSessionsStore.getState();
  const conversationId = sessions.activeId;
  if (!conversationId) return null;
  const conversation = sessions.conversations[conversationId];
  const api = docks.get(conversationId);
  if (!conversation || !api) return null;
  return { api, conversationId, projectId: conversation.projectId };
}

export function addSidePanelTerminal(): void {
  const active = activeDock();
  if (!active) return;
  useSidePanelStore.getState().ensureOpen();
  const count = active.api.panels.length;
  active.api.addPanel({
    id: crypto.randomUUID(),
    component: 'terminal',
    title: count === 0 ? 'Terminal' : `Terminal ${count + 1}`,
    params: { conversationId: active.conversationId, projectId: active.projectId },
  });
}

export function addSidePanelChanges(opts?: { title?: string }): void {
  const active = activeDock();
  if (!active) return;
  useSidePanelStore.getState().ensureOpen();
  const existing = active.api.getPanel('changes');
  if (existing) {
    existing.focus();
    return;
  }
  active.api.addPanel({
    id: 'changes',
    component: 'changes',
    title: opts?.title ?? 'Changes',
    params: { conversationId: active.conversationId, projectId: active.projectId },
  });
}

export function addSidePanelFiles(opts?: { title?: string }): void {
  const active = activeDock();
  if (!active) return;
  useSidePanelStore.getState().ensureOpen();
  revealFilesPanel(active.api, active.conversationId, active.projectId, opts?.title);
}

function revealFilesPanel(
  api: DockviewApi,
  conversationId: string,
  projectId: string,
  title?: string
): void {
  const existing = api.getPanel('files');
  if (existing) {
    existing.focus();
    return;
  }
  api.addPanel({
    id: 'files',
    component: 'files',
    title: title ?? 'Files',
    params: { conversationId, projectId },
  });
}

/**
 * 在会话所属 dock 打开文件，btw 沿既有父路由；Markdown 查看器选择预览，行号入口使用源码。
 *
 * Open files in their conversation-owned dock, preserving the existing btw parent route; Markdown requests preview and line references use source.
 */
export function openSidePanelFile(
  conversationId: string,
  rel: string,
  line?: number,
  viewer?: 'text' | 'markdown'
): void {
  const sessions = useSessionsStore.getState();
  const dockId = resolveSidePanelDockConversationId(sessions.conversations, conversationId);
  // An unproven or different-workspace child must not open a file in another host.
  if (sessions.conversations[conversationId]?.child && dockId === conversationId) return;
  const projectId = sessions.conversations[dockId]?.projectId;
  if (!projectId) return;
  useSidePanelStore.getState().ensureOpen(dockId);
  const target: FileTarget = viewer ? [rel, line, viewer] : line ? [rel, line] : [rel];
  const open = filesOpeners.get(dockId);
  if (open) open(...target);
  else pendingFileOpens.set(dockId, target);
  const api = docks.get(dockId);
  if (api) revealFilesPanel(api, dockId, projectId);
  else pendingFilesReveal.add(dockId);
}

/** Open only bytes returned from the clicked citation, independently of the Files workspace editor. */
export function openSidePanelFileCitation(
  conversationId: string,
  citationId: string,
  file: FileCitationPreview
): void {
  // The citation IPC accepts saved local root chats only. Its owner is the original chat, not the active one.
  const projectId = useSessionsStore.getState().conversations[conversationId]?.projectId;
  if (!projectId) return;
  useSidePanelStore.getState().ensureOpen(conversationId);
  const dock = docks.get(conversationId);
  if (!dock) {
    const pending = pendingFileCitations.get(conversationId) ?? new Map();
    pending.set(citationId, file);
    pendingFileCitations.set(conversationId, pending);
    return;
  }
  const id = `${FILE_CITATION_PANEL}:${citationId}`;
  const title = file.path.split(/[/\\]/).at(-1) || file.path;
  const params: FileCitationPanelParams = {
    ...file,
    line: file.line,
    revision: file.revision,
    conversationId,
    projectId,
    citationId,
  };
  const existing = dock.getPanel(id);
  if (existing) {
    if (existing.api.title !== title) existing.api.setTitle(title);
    existing.api.updateParameters(params);
    existing.focus();
    return;
  }
  dock.addPanel({ id, component: FILE_CITATION_PANEL, title, params, renderer: 'always' });
}

export function addSidePanelBrowser(opts?: {
  title?: string;
  conversationId?: string;
  tabId?: string;
  /** Agent 导航/恢复通知只登记面板，不抢用户输入焦点或当前正在查看的 tab。 */
  background?: boolean;
}): void {
  const sessions = useSessionsStore.getState();
  const ownerId = opts?.conversationId ?? sessions.activeId;
  if (!ownerId) return;
  const conversation = sessions.conversations[ownerId];
  if (!conversation) return;
  const dockId = resolveSidePanelDockConversationId(sessions.conversations, ownerId);
  const api = docks.get(dockId);
  useSidePanelStore.getState().ensureOpen(dockId);
  const tabId = opts?.tabId ?? `browser:${crypto.randomUUID()}`;
  if (!api) {
    pendingBrowserReveal.push({
      conversationId: dockId,
      tabId,
      ownerId,
      background: opts?.background,
    });
    return;
  }
  const existing = api.getPanel(tabId);
  if (existing) {
    if (!opts?.background) existing.focus();
    return;
  }
  api.addPanel({
    id: tabId,
    component: 'browser',
    title: opts?.title ?? 'Browser',
    params: { conversationId: ownerId, projectId: conversation.projectId },
    // 空 dock 的首个页必须成为 active 才会上报 viewport；激活不等于调用 focus()。
    ...(opts?.background ? { inactive: api.panels.length > 0 } : {}),
  });
}

/** 用户点击网页链接：每次新建所属会话的 tab，失败交还调用者提示，不静默吞掉。 */
export async function openSidePanelBrowserUrl(conversationId: string, raw: string): Promise<void> {
  if (!useSessionsStore.getState().conversations[conversationId]) {
    throw new Error('Conversation is unavailable.');
  }
  const url = parseMarkdownHttpUrl(raw);
  if (!url) throw new Error('Invalid URL');
  const tabId = `browser:${crypto.randomUUID()}`;
  addSidePanelBrowser({ conversationId, tabId });
  const result = await window.electronAPI.browser.navigate(tabId, conversationId, url);
  if (!result.ok) throw new Error(result.error || 'Navigation failed');
}

/** Single design surface per dock; defer until fromJSON has finished. */
export function addSidePanelDesign(opts?: Partial<DesignReveal>): void {
  const sessions = useSessionsStore.getState();
  const ownerId = opts?.conversationId ?? sessions.activeId;
  if (!ownerId || !sessions.conversations[ownerId]) return;
  const dockId = resolveSidePanelDockConversationId(sessions.conversations, ownerId);
  const side = useSidePanelStore.getState();
  // maximize opens and sizes atomically, before a cold dock first renders at the default width.
  if (opts?.width === 'max') side.maximize(dockId);
  side.ensureOpen(dockId);
  const api = docks.get(dockId);
  if (!api) {
    pendingDesignReveal.set(dockId, {
      ...opts,
      conversationId: ownerId,
      width: opts?.width === 'max' ? undefined : opts?.width,
    });
    return;
  }
  // 「max」= 面板拉满但保留会话区；全屏会把正在对话的会话框整个盖掉
  if (typeof opts?.width === 'number') side.setWidth(dockId, opts.width);
  const existing = api.getPanel('design');
  if (existing) {
    existing.api.updateParameters({ conversationId: ownerId });
    existing.focus();
    return;
  }
  api.addPanel({
    id: 'design',
    component: 'design',
    title: opts?.title ?? 'Design',
    params: { conversationId: ownerId, projectId: sessions.conversations[ownerId].projectId },
  });
}

export function revealMobileDevicesPanel(
  api: DockviewApi,
  group?: Parameters<DockviewApi['addPanel']>[0]['position']
) {
  const id = 'mobile-devices';
  const existing = api.getPanel(id);
  if (existing) existing.focus();
  else
    api.addPanel({ id, component: id, title: 'Mobile devices', ...(group && { position: group }) });
}

/** A direct entry into the current local Code session, without an intermediate external window. */
export function addSidePanelMobileDevices(conversationId: string): void {
  const conversation = useSessionsStore.getState().conversations[conversationId];
  if (!conversation || conversation.btwParentId) return;
  useSidePanelStore.getState().ensureOpen(conversationId);
  const api = docks.get(conversationId);
  if (api) revealMobileDevicesPanel(api);
  else pendingMobileDevices.add(conversationId);
}

export function setSidePanelDesignVisible(conversationId: string, visible: boolean): void {
  if (visible) return; // Availability is not an instruction to steal focus/open.
  const dockId = resolveSidePanelDockConversationId(
    useSessionsStore.getState().conversations,
    conversationId
  );
  pendingDesignReveal.delete(dockId);
  docks.get(dockId)?.getPanel('design')?.api.close();
}
/** 「右侧栏是插件 open 时才打开的」记录：只有这类侧栏才允许关页面时一并收起 */
const pluginOpenedPanel = new Set<string>();

/** Open only a Main-authorized registered view in its conversation-owned dock. */
export function openSidePanelPluginView(opts: PluginViewReveal): void {
  const conversations = useSessionsStore.getState().conversations;
  if (!conversations[opts.conversationId]) return;
  const dockId = resolveSidePanelDockConversationId(conversations, opts.conversationId);
  const id = `plugin:${opts.pluginId}:${opts.viewId}`;
  const key = `${dockId}\n${id}`;
  const panelWasOpen = useSidePanelStore.getState().uiByConversation[dockId]?.open === true;
  useSidePanelStore.getState().ensureOpen(dockId);
  const api = docks.get(dockId);
  // 用户本来就开着右侧栏时清掉旧记录，免得之后 close 收起用户自己开的栏
  if (panelWasOpen) pluginOpenedPanel.delete(key);
  else if (!api?.getPanel(id)) pluginOpenedPanel.add(key);
  if (!api) {
    let pending = pendingPluginViews.get(dockId);
    if (!pending) {
      pending = new Map();
      pendingPluginViews.set(dockId, pending);
    }
    pending.set(id, opts);
    return;
  }
  const existing = api.getPanel(id);
  if (existing) {
    existing.api.updateParameters({ conversationId: opts.conversationId });
    existing.focus();
    return;
  }
  api.addPanel({
    id,
    component: 'plugin',
    title: opts.title,
    params: { conversationId: opts.conversationId, pluginId: opts.pluginId, viewId: opts.viewId },
  });
}

/**
 * 关掉本插件的侧栏页面。与 `open` 对称：
 * - 只关 `pluginId:viewId` 这一页，别人的页面和用户自己的布局不动；
 * - 右侧栏是为它打开的、且它仍是当前标签时一并收起；
 * - 用户原本开着的侧栏永远不因插件 close 收起。
 */
export function closeSidePanelPluginView(opts: {
  conversationId: string;
  pluginId: string;
  viewId: string;
}): void {
  const dockId = resolveSidePanelDockConversationId(
    useSessionsStore.getState().conversations,
    opts.conversationId
  );
  const id = `plugin:${opts.pluginId}:${opts.viewId}`;
  const restore = pluginOpenedPanel.delete(`${dockId}\n${id}`);
  const pending = pendingPluginViews.get(dockId);
  if (pending?.delete(id) && pending.size === 0) pendingPluginViews.delete(dockId);
  const api = docks.get(dockId);
  const panel = api?.getPanel(id);
  // 关之前先记下它是不是当前标签：close() 之后 activePanel 就变了
  const active = api?.activePanel?.id === id;
  panel?.api.close();
  if (!restore) return;
  // dock 还没挂载：侧栏里只可能有这个挂起的视图，可以直接收
  if (api && (!panel || !active)) return;
  useSidePanelStore.setState((state) => {
    const ui = state.uiByConversation[dockId] ?? { open: true, width: state.lastWidth };
    return ui.open
      ? { uiByConversation: { ...state.uiByConversation, [dockId]: { ...ui, open: false } } }
      : {};
  });
}

export function addSidePanelBtw(opts?: { title?: string }): void {
  const active = activeDock();
  if (!active) return;
  useSidePanelStore.getState().ensureOpen();
  const count = active.api.panels.filter((panel) => panel.id.startsWith('btw:')).length;
  active.api.addPanel({
    id: `btw:${crypto.randomUUID()}`,
    component: 'btw',
    title: opts?.title ?? (count === 0 ? 'Btw' : `Btw ${count + 1}`),
    params: { conversationId: active.conversationId, projectId: active.projectId },
  });
}

/** Explicit, read-only reveal in the parent's owner dock. Never switches the main chat selection. */
export function addSidePanelSubagent(opts: {
  parentConversationId: string;
  childConversationId: string;
  title?: string;
}): void {
  const conversations = useSessionsStore.getState().conversations;
  const agentId = conversations[opts.childConversationId]?.child?.agentInstanceId;
  if (!agentId) return;
  const target = resolveSubagentTarget(conversations, opts.parentConversationId, agentId);
  if (!target || target.childConversationId !== opts.childConversationId) return;
  revealSubagentPanel({ ...target, title: opts.title ?? target.title });
}

export function addSidePanelSubagentDirectory(parentConversationId: string): void {
  if (!useSessionsStore.getState().conversations[parentConversationId]) return;
  revealSubagentPanel({ parentConversationId });
}

function revealSubagentPanel(opts: SubagentReveal): void {
  const conversations = useSessionsStore.getState().conversations;
  const dockId = resolveSidePanelDockConversationId(conversations, opts.parentConversationId);
  if (!conversations[dockId]) return;
  const id = opts.childConversationId
    ? `subagent:${opts.childConversationId}`
    : `subagents:${opts.parentConversationId}`;
  useSidePanelStore.getState().ensureOpen(dockId);
  const api = docks.get(dockId);
  if (!api) {
    let pending = pendingSubagentReveal.get(dockId);
    if (!pending) {
      pending = new Map();
      pendingSubagentReveal.set(dockId, pending);
    }
    pending.set(id, opts);
    return;
  }
  const existing = api.getPanel(id);
  if (existing) {
    existing.focus();
    return;
  }
  api.addPanel({
    id,
    component: opts.childConversationId ? 'subagent-session' : 'subagent-directory',
    title: opts.title ?? 'Agents',
    params: opts,
  });
}

export function addSidePanelWorkflow(opts: {
  conversationId: string;
  runId: string;
  title?: string;
}): void {
  const revealKey = `${opts.conversationId}:${opts.runId}`;
  if (revealedWorkflowRuns.has(revealKey)) return;
  const sessions = useSessionsStore.getState();
  const conversation = sessions.conversations[opts.conversationId];
  if (!conversation) return;
  if (!selectWorkflowAvailable(useSettingsStore.getState(), conversation.projectId)) return;
  const dockId = resolveSidePanelDockConversationId(sessions.conversations, opts.conversationId);
  const api = docks.get(dockId);
  useSidePanelStore.getState().ensureOpen(dockId);
  if (!api) {
    pendingWorkflowReveal.push({
      conversationId: dockId,
      ownerId: opts.conversationId,
      title: opts.title ?? 'Workflow',
      runId: opts.runId,
    });
    return;
  }
  revealedWorkflowRuns.add(revealKey);
  if (api.getPanel('workflow')) return;
  api.addPanel({
    id: 'workflow',
    component: 'workflow',
    title: opts.title ?? 'Workflow',
    params: { conversationId: opts.conversationId, projectId: conversation.projectId },
  });
}

export function closeSidePanelBrowser(conversationId: string, tabId: string): void {
  const dockId = resolveSidePanelDockConversationId(
    useSessionsStore.getState().conversations,
    conversationId
  );
  docks.get(dockId)?.getPanel(tabId)?.api.close();
}

export function disposeConversationResources(conversationId: string): void {
  pendingMobileDevices.delete(conversationId);
  const api = docks.get(conversationId);
  docks.delete(conversationId);
  // A btw parent may own observers inside another dock. Close only its transient views.
  for (const dock of docks.values()) {
    for (const panel of [...dock.panels]) {
      if (!isSubagentPanel(panel.id)) continue;
      const params = panel.api.getParameters<SubagentReveal>();
      if (
        params?.parentConversationId === conversationId ||
        params?.childConversationId === conversationId
      )
        panel.api.close();
    }
  }
  filesTabClosers.delete(conversationId);
  filesOpeners.delete(conversationId);
  pendingFileOpens.delete(conversationId);
  pendingFilesReveal.delete(conversationId);
  pendingFileCitations.delete(conversationId);
  pendingDesignReveal.delete(conversationId);
  pendingSubagentReveal.delete(conversationId);
  for (const pending of pendingSubagentReveal.values()) {
    for (const [key, item] of pending) {
      if (
        item.parentConversationId === conversationId ||
        item.childConversationId === conversationId
      )
        pending.delete(key);
    }
  }
  pendingBrowserReveal.splice(
    0,
    pendingBrowserReveal.length,
    ...pendingBrowserReveal.filter((item) => item.conversationId !== conversationId)
  );
  pendingWorkflowReveal.splice(
    0,
    pendingWorkflowReveal.length,
    ...pendingWorkflowReveal.filter((item) => item.conversationId !== conversationId)
  );
  for (const runId of [...revealedWorkflowRuns]) {
    if (runId.startsWith(`${conversationId}:`)) revealedWorkflowRuns.delete(runId);
  }
  if (api) {
    for (const panel of [...api.panels]) {
      if (isSubagentPanel(panel.id) || isFileCitationPanel(panel.id)) continue;
      if (['changes', 'files', 'design', 'mobile-devices'].includes(panel.id)) continue;
      if (panel.id === 'browser' || panel.id.startsWith('browser:')) continue;
      releaseTerminal(panel.id);
      void window.electronAPI?.terminal?.dispose(panel.id);
    }
  }
  void window.electronAPI?.browser?.closeSession?.(conversationId);
  useSidePanelStore.getState().forgetConversation(conversationId);
}

export function closeActiveSidePanelTab(): void {
  const active = activeDock();
  if (!active) return;
  if (active.api.activePanel?.id === 'files') {
    const closeFile = filesTabClosers.get(active.conversationId);
    if (closeFile?.()) return;
  }
  if (active.api.activePanel) requestSidePanelTabClose(active.api.activePanel.api);
}
