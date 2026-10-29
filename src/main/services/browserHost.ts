import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertAllowedCdpMethod } from '@shared/browser/cdpPolicy';
import { parseDesignBinding, sanitizeUiElementPayload } from '@shared/browser/designMode';
import { parseBrowserDevice } from '@shared/browser/devices';
import {
  assertDevtoolsIdle,
  DEVTOOLS_DOCK_BRIDGE_SCRIPT,
  type DevtoolsDockMessage,
  type DevtoolsDockSide,
  type DevtoolsRect,
  devtoolsGuestBounds,
  parseDevtoolsDockMessage,
  resetUndockedDevtoolsPreference,
} from '@shared/browser/devtools';
import { pickFaviconUrl } from '@shared/browser/favicon';
import {
  pageCheckedScript,
  pagePrepareInputScript,
  pageScrollIntoViewScript,
  pageWaitScript,
  parseBrowserKey,
  parseBrowserWait,
} from '@shared/browser/interactionScripts';
import {
  DESIGN_MODE_BINDING,
  PAGE_DESIGN_MODE_COMPOSE_SCRIPT,
  PAGE_DESIGN_MODE_DISABLE_SCRIPT,
  PAGE_DESIGN_MODE_ENABLE_SCRIPT,
  PAGE_DESIGN_MODE_HIDE_SCRIPT,
  PAGE_SETTLE_FRAMES_SCRIPT,
  PAGE_SNAPSHOT_SCRIPT,
  PAGE_UNLOCK_OVERLAY_SCRIPT,
  pageBoundingBoxScript,
  pageClickXyScript,
  pageDesignModeShowFrozenScript,
  pageDragPointsScript,
  pageHighlightScript,
  pageScrollScript,
  pageSelectOptionScript,
} from '@shared/browser/pageScripts';
import {
  type PageReadSnapshot,
  parsePageReadSnapshot,
  parseReadRequest,
  readPageSlice,
} from '@shared/browser/reading';
import { pageReadScript } from '@shared/browser/readingScripts';
import {
  type BrowserSnapshot,
  isKnownRef,
  parseSnapshotEntries,
  renderSnapshot,
} from '@shared/browser/snapshot';
import {
  dropPersistedTabsForSession,
  type PersistedBrowserTab,
  parsePersistedBrowserTabs,
  serializePersistedBrowserTabs,
} from '@shared/browser/tabPersist';
import { assertAllowedUrl } from '@shared/browser/urlPolicy';
import type { BrowserViewport } from '@shared/browser/viewport';
import { effectiveBrowserViewport } from '@shared/browser/viewport';
import { mergeBrowserSearchTabs } from '@shared/searchAnything';
import type { BrowserOp } from '@shared/types/agent';
import type {
  BrowserClearKind,
  BrowserDesignModeEvent,
  BrowserDevice,
  BrowserTabState,
} from '@shared/types/browser';
import type { Session, WebContents } from 'electron';
import { app, BrowserWindow, session, WebContentsView } from 'electron';
import { getWorkbenchView } from '../windows/createAppWindow';
import { pinnedWorkbenchBounds } from '../windows/win32Restore';
import { BrowserDownloads } from './browserDownloads';
import { assertBrowserUrl, resolveLocalCwdForBrowser } from './browserFileRoot';
import { BrowserHistoryStore } from './browserHistory';
import {
  BROWSER_TAB_CLOSED_NOTICE,
  type BrowserActor,
  BrowserTabClaims,
  browserTabBusyMessage,
} from './browserTabClaims';

/**
 * 内嵌浏览器宿主：guest 页只活在 Main。独立 persist session，与编辑器 defaultSession 切开。
 * 第一刀无头：view 不挂窗口，导航 / 快照 / 点 / 填 / 截图全走 webContents。
 * 不 import ipcMain；协议入口在 ipc/agent.ts。
 */

const PARTITION_SUFFIX = '-browser';
const NAVIGATE_TIMEOUT_MS = 30_000;
const ABORT_GRACE_MS = 2_000;
const MAX_HEADLESS_TABS = 4;
/** 会话不在看的 Browser 进程，闲置这么久就卸掉（URL 仍落盘） */
const IDLE_MS = 5 * 60 * 1000;
const IDLE_TICK_MS = 30_000;
const SCREENSHOT_MAX_WIDTH = 1280;
/**
 * 无头 tab 的布局 viewport。contentView 的子视图全画在 renderer 之上，无头只能
 * `setVisible(false)`；但隐藏后 view 尺寸归零，页面布局全是 0×0（快照抓不到块级
 * 元素、截图为空），所以再用 CDP `Emulation.setDeviceMetricsOverride` 撑出尺寸。
 */
const HEADLESS_BOUNDS = { width: 1280, height: 800 };

export function partitionName(isPackaged: boolean): string {
  return `persist:${isPackaged ? 'enso' : 'enso-dev'}${PARTITION_SUFFIX}`;
}

/** clear* 前再校验一遍：只准动我们自己的罐。 */
export function isBrowserPartition(name: string): boolean {
  return name.startsWith('persist:') && name.endsWith(PARTITION_SUFFIX);
}

export type PageScreenshotClip = {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
};

/** CDP `Page.captureScreenshot` 入参。冻帧必须拍当前合成视口，否则 fixed 顶栏会丢。 */
export function pageScreenshotCdpParams(
  clip?: PageScreenshotClip,
  opts?: { captureBeyondViewport?: boolean }
): {
  format: 'png';
  captureBeyondViewport: boolean;
  fromSurface?: true;
  clip?: PageScreenshotClip;
} {
  if (opts?.captureBeyondViewport === false) {
    return clip
      ? { format: 'png', captureBeyondViewport: false, fromSurface: true, clip }
      : { format: 'png', captureBeyondViewport: false, fromSurface: true };
  }
  return { format: 'png', captureBeyondViewport: true, clip };
}

/** 隐藏 tab 仍要有 layout 尺寸，并假装 focused，避免后台 rAF / 动画被掐。 */
export function hiddenTabCdpCommands(): Array<{ method: string; params: Record<string, unknown> }> {
  return [
    {
      method: 'Emulation.setDeviceMetricsOverride',
      params: {
        width: HEADLESS_BOUNDS.width,
        height: HEADLESS_BOUNDS.height,
        deviceScaleFactor: 0,
        mobile: false,
      },
    },
    { method: 'Emulation.setFocusEmulationEnabled', params: { enabled: true } },
  ];
}

export function shownTabCdpCommands(): Array<{ method: string; params: Record<string, unknown> }> {
  return [
    { method: 'Emulation.clearDeviceMetricsOverride', params: {} },
    { method: 'Emulation.setFocusEmulationEnabled', params: { enabled: false } },
  ];
}

export type BrowserMouseInputEvent = {
  type: 'mouseDown' | 'mouseMove' | 'mouseUp';
  x: number;
  y: number;
  button: 'left';
  clickCount?: number;
};

/** HTML5 DnD 需要可信指针序列；合成 MouseEvent 页面不认。 */
export function dragInputEvents(
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 10
): BrowserMouseInputEvent[] {
  const x0 = Math.round(from.x);
  const y0 = Math.round(from.y);
  const x1 = Math.round(to.x);
  const y1 = Math.round(to.y);
  const count = Math.max(8, steps);
  const events: BrowserMouseInputEvent[] = [
    { type: 'mouseDown', x: x0, y: y0, button: 'left', clickCount: 1 },
  ];
  const dist = Math.hypot(x1 - x0, y1 - y0) || 1;
  events.push({
    type: 'mouseMove',
    x: Math.round(x0 + ((x1 - x0) / dist) * 8),
    y: Math.round(y0 + ((y1 - y0) / dist) * 8),
    button: 'left',
  });
  for (let i = 1; i <= count; i++) {
    const t = i / count;
    events.push({
      type: 'mouseMove',
      x: Math.round(x0 + (x1 - x0) * t),
      y: Math.round(y0 + (y1 - y0) * t),
      button: 'left',
    });
  }
  events.push({ type: 'mouseUp', x: x1, y: y1, button: 'left', clickCount: 1 });
  return events;
}

interface Tab {
  id: string;
  view: WebContentsView;
  /** 官方 DevTools 前端；懒创建 */
  devtools?: WebContentsView;
  ownerSessionId: string;
  createdAt: number;
  lastSnapshot?: BrowserSnapshot;
  locked: boolean;
  /** webContents 首次 dom-ready 前 debugger.attach 会让 Main 段错误 */
  ready: boolean;
  devtoolsOpen: boolean;
  /** DevTools 前端「Dock side」选择；undocked 时前端住在独立窗口 */
  devtoolsDock: DevtoolsDockSide;
  /** 停靠时前端上报的网页区域（DevTools 视图内坐标）；未上报为 null */
  devtoolsPage: DevtoolsRect | null;
  devtoolsWindow?: BrowserWindow;
  designMode: boolean;
  favicon: string | null;
  designBinding?: boolean;
  pickSeq: number;
  /** 正在发合成输入（drag / CDP Input.*），不将其当作人工页面改动 */
  synthetic: number;
  /** 上一个占用该 tab 的成员会话；换人后旧快照的 ref 作废 */
  lastHolder?: string;
  device: BrowserDevice;
  /** 人工操作 / 导航后的页面代际，仅用于拒绝迟到快照，不是控制权。 */
  generation: number;
  snapshotSeq: number;
  readSnapshot?: PageReadSnapshot;
  readKey?: string;
  queue: Promise<unknown>;
  active?: AbortController;
  operationSignal?: AbortSignal;
  emulationQueue: Promise<void>;
  emulationKey?: string;
}

const EMPTY_STATE: BrowserTabState = {
  tabId: null,
  url: '',
  title: '',
  favicon: null,
  loading: false,
  canGoBack: false,
  canGoForward: false,
  locked: false,
  devtoolsOpen: false,
  designMode: false,
  holder: null,
};

interface PageInfo {
  url: string;
  title: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const paramString = (params: unknown, key: string): string => {
  const value = isRecord(params) ? params[key] : undefined;
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} is required`);
  return value;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const USER_INPUT = new Set(['mouseDown', 'rawKeyDown', 'keyDown']);

export class BrowserHost {
  private readonly tabs = new Map<string, Tab>();
  private readonly currentBySession = new Map<string, string>();
  /** agent 自己的当前 tab：UI 面板可见性/用户浏览不得改写，否则下一条不带 tabId 的工具会打错页 */
  private readonly agentBySession = new Map<string, string>();
  private readonly tabClaims = new BrowserTabClaims({
    onChange: (tabId) => {
      const tab = this.tabs.get(tabId);
      if (tab) this.emitState(tab.ownerSessionId, tabId);
    },
  });
  private counter = 0;
  private guestSession?: Session;
  private hostWindow: () => BrowserWindow | null = () => null;

  /** 渲染层当前展示的 dock tab 与面板矩形 */
  /** covered：renderer 有浮层压在网页上，guest 要沉到 workbench 之下透洞显示 */
  /** 模态浮层开着：不等 rAF 上报矩形，直接不抬升任何 guest */
  private overlayActive = false;
  private shown: {
    tabId: string;
    sessionId: string;
    viewport: BrowserViewport;
    covered: boolean;
  } | null = null;
  private shownDevtools: {
    tabId: string;
    sessionId: string;
    viewport: BrowserViewport;
    covered: boolean;
  } | null = null;
  private readonly stateListeners = new Set<
    (sessionId: string, tabId: string, state: BrowserTabState) => void
  >();
  private readonly revealListeners = new Set<(sessionId: string, tabId: string) => void>();
  private readonly closeListeners = new Set<(sessionId: string, tabId: string) => void>();
  private readonly designListeners = new Set<(event: BrowserDesignModeEvent) => void>();
  /** renderer 还没报矩形前先不关 tab，避免回合结束跑赢面板挂载 */
  private readonly pendingReveal = new Set<string>();
  /** 用户见过的 tab：切走 Terminal / 重启后仍恢复 */
  private readonly userTabs = new Set<string>();
  private persisted: Record<string, PersistedBrowserTab> = {};
  private persistedLoaded = false;
  private disposing = false;
  private readonly lastSeen = new Map<string, number>();
  private idleTimer: ReturnType<typeof setInterval> | undefined;
  private historyStore?: BrowserHistoryStore;
  private downloadsStore?: BrowserDownloads;
  private readonly downloadsListeners = new Set<(conversationId: string) => void>();

  onDownloadsChanged(listener: (conversationId: string) => void): () => void {
    this.downloadsListeners.add(listener);
    return () => this.downloadsListeners.delete(listener);
  }

  private recordsQuery(params: unknown) {
    if (params !== undefined && !isRecord(params))
      throw new Error('Record params must be an object');
    const p = isRecord(params) ? params : {};
    if (p.query !== undefined && (typeof p.query !== 'string' || p.query.length > 500))
      throw new Error('Invalid query');
    for (const key of ['offset', 'limit']) {
      const value = p[key];
      if (
        value !== undefined &&
        (typeof value !== 'number' ||
          !Number.isSafeInteger(value) ||
          value < (key === 'limit' ? 1 : 0) ||
          value > (key === 'limit' ? 200 : 1000000))
      )
        throw new Error(`Invalid ${key}`);
    }
    return {
      ...(typeof p.query === 'string' ? { query: p.query } : {}),
      ...(typeof p.offset === 'number' ? { offset: p.offset } : {}),
      ...(typeof p.limit === 'number' ? { limit: p.limit } : {}),
    };
  }

  private getHistory(): BrowserHistoryStore {
    this.historyStore ??= new BrowserHistoryStore({
      filePath: join(app.getPath('userData'), 'browser-history.json'),
    });
    return this.historyStore;
  }

  private getDownloads(): BrowserDownloads {
    this.downloadsStore ??= new BrowserDownloads({
      filePath: join(app.getPath('userData'), 'browser-downloads.json'),
      downloadDir: join(app.getPath('downloads'), 'EnsoCode'),
      onChange: (conversationId) => {
        for (const listener of this.downloadsListeners) listener(conversationId);
      },
    });
    return this.downloadsStore;
  }

  async history(conversationId: string, params: unknown): Promise<unknown> {
    const query = this.recordsQuery(params);
    const action = isRecord(params) ? (params.action ?? 'list') : 'list';
    const store = this.getHistory();
    if (action === 'remove') store.remove(conversationId, paramString(params, 'id'));
    else if (action === 'clear') store.clear(conversationId);
    else if (action !== 'list') throw new Error('Invalid history action');
    return store.query(conversationId, query);
  }

  async downloads(conversationId: string, params: unknown): Promise<unknown> {
    const query = this.recordsQuery(params);
    const action = isRecord(params) ? (params.action ?? 'list') : 'list';
    const store = this.getDownloads();
    if (
      action === 'pause' ||
      action === 'resume' ||
      action === 'cancel' ||
      action === 'remove' ||
      action === 'reveal'
    )
      await store.action(conversationId, paramString(params, 'id'), action);
    else if (action !== 'list') throw new Error('Invalid download action');
    return store.query(conversationId, query);
  }

  private ownedTab(tabId: string, conversationId: string): Tab {
    const tab = this.tabs.get(tabId);
    if (!tab)
      throw new Error(
        'Browser tab is closed or unknown. Omit tabId to use the current tab, or call browser_tabs to list open tabs.'
      );
    if (tab.ownerSessionId !== conversationId) throw new Error('Browser tab owner mismatch');
    return tab;
  }

  private invalidateRefs(tab: Tab): void {
    tab.lastSnapshot = undefined;
    tab.readSnapshot = undefined;
    tab.readKey = undefined;
  }

  private userInteracted(tab: Tab): void {
    tab.generation += 1;
    this.invalidateRefs(tab);
  }

  async setDevice(
    tabId: string,
    conversationId: string,
    device: unknown
  ): Promise<BrowserTabState> {
    const tab = this.ownedTab(tabId, conversationId);
    const next = parseBrowserDevice(device);
    // 只有要应用模拟时才占用 CDP；关闭预览不碰 debugger，DevTools 开着也要能退出
    if (next.enabled) assertDevtoolsIdle(tab.devtoolsOpen);
    tab.device = next;
    this.invalidateRefs(tab);
    tab.emulationKey = undefined;
    this.layout();
    await this.applyEmulation(
      tab,
      this.shown?.tabId === tab.id ? this.shown.viewport : null,
      next.enabled
    );
    this.emitState(conversationId, tabId);
    return this.stateOf(tab);
  }

  stop(tabId: string): void {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    this.userInteracted(tab);
    tab.view.webContents.stop();
  }

  /** guest view 需要挂在某扇窗口上才有 viewport；由 main/index.ts 注入主窗口获取器。 */
  setHostWindow(provider: () => BrowserWindow | null): void {
    this.hostWindow = provider;
  }

  onState(
    listener: (sessionId: string, tabId: string, state: BrowserTabState) => void
  ): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  onReveal(listener: (sessionId: string, tabId: string) => void): () => void {
    this.revealListeners.add(listener);
    return () => this.revealListeners.delete(listener);
  }

  onTabClosed(listener: (sessionId: string, tabId: string) => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  onDesignMode(listener: (event: BrowserDesignModeEvent) => void): () => void {
    this.designListeners.add(listener);
    return () => this.designListeners.delete(listener);
  }

  private requestReveal(sessionId: string, tabId?: string): void {
    const tab =
      (tabId ? this.tabs.get(tabId) : this.tabFor(sessionId)) ?? this.createTab(sessionId);
    this.pendingReveal.add(sessionId);
    this.userTabs.add(tab.id);
    for (const listener of this.revealListeners) listener(sessionId, tab.id);
  }

  state(tabId: string): BrowserTabState {
    const tab = this.tabs.get(tabId) ?? this.tabFor(tabId);
    if (!tab) return EMPTY_STATE;
    return this.stateOf(tab);
  }

  private stateOf(tab: Tab): BrowserTabState {
    const contents = tab.view.webContents;
    const holder = this.tabClaims.holder(tab.id);
    return {
      tabId: tab.id,
      url: contents.getURL(),
      title: contents.getTitle(),
      favicon: tab.favicon,
      loading: contents.isLoading(),
      canGoBack: contents.navigationHistory.canGoBack(),
      canGoForward: contents.navigationHistory.canGoForward(),
      locked: tab.locked,
      device: tab.device,
      devtoolsOpen: tab.devtoolsOpen,
      ...(tab.devtoolsOpen ? { devtoolsDock: tab.devtoolsDock } : {}),
      designMode: tab.designMode,
      holder: holder ? { conversationId: holder.sessionId, name: holder.name } : null,
    };
  }

  private emitState(sessionId: string, tabId?: string): void {
    const tab = (tabId ? this.tabs.get(tabId) : undefined) ?? this.tabFor(sessionId);
    const state = tab ? this.stateOf(tab) : EMPTY_STATE;
    if (tab && this.userTabs.has(tab.id) && state.url.startsWith('http')) {
      this.rememberTab(tab.id, {
        url: state.url,
        title: state.title,
        conversationId: tab.ownerSessionId,
        at: Date.now(),
      });
    }
    if (tab && state.url.startsWith('file:')) this.forgetTab(tab.id);
    for (const listener of this.stateListeners) listener(sessionId, tab?.id ?? '', state);
  }

  /** 渲染层：某个 dock tab 可见时报矩形；null = 该 tab 隐藏 */
  setViewport(
    tabId: string,
    sessionId: string,
    viewport: BrowserViewport | null,
    covered = false
  ): BrowserTabState {
    if (viewport) {
      // 面板 id 与浏览器 tab id 同形但不等价：只认已存在的 tab。未知 id 交给
      // restoreTab 按持久化 URL 懒恢复；没有 URL 就不该建一个空白 tab，更不能
      // 把 agent 的「当前 tab」指过去（否则下一次不带 tabId 的 reload/导航落到空页）。
      const tab = this.tabs.get(tabId);
      if (tab) {
        if (tab.ownerSessionId === sessionId) this.currentBySession.set(sessionId, tabId);
        this.userTabs.add(tabId);
      } else {
        void this.restoreTab(tabId, sessionId);
      }
      this.pendingReveal.delete(sessionId);
      this.shown = { tabId, sessionId, viewport, covered };
      this.touch(tabId);
    } else if (this.shown?.tabId === tabId) {
      this.shown = null;
    }
    this.layout();
    return this.state(tabId);
  }

  /** 渲染层有模态浮层（Dialog / 全屏预览等）时，所有 guest 立刻沉到 workbench 之下 */
  setOverlayActive(active: boolean): void {
    if (this.overlayActive === active) return;
    this.overlayActive = active;
    this.layout();
  }

  /**
   * 上报方（renderer）崩溃 / 重载 / 不再上报：覆盖状态是「最后一次上报」而不是持久事实，
   * 沉下去的闩锁会把 guest 永久变成不可交互。没有活着的上报方就回落到「没被盖住」。
   */
  resetOverlayReports(): void {
    this.overlayActive = false;
    if (this.shown?.covered) this.shown = { ...this.shown, covered: false };
    if (this.shownDevtools?.covered) {
      this.shownDevtools = { ...this.shownDevtools, covered: false };
    }
    this.layout();
  }

  setDevTools(tabId: string, open: boolean): BrowserTabState {
    const tab = this.tabs.get(tabId);
    if (!tab) return EMPTY_STATE;
    if (open && tab.designMode) void this.setDesignMode(tabId, false);
    if (open === tab.devtoolsOpen) return this.stateOf(tab);
    tab.devtoolsOpen = open;
    if (open) {
      tab.devtoolsDock = 'bottom';
      tab.devtoolsPage = null;
      // debugger 让位后，不能再把旧模拟配置当成已经生效。
      tab.emulationKey = undefined;
      this.detachDebugger(tab);
      this.ensureDevTools(tab);
    } else {
      this.teardownDevTools(tab);
    }
    this.layout();
    this.emitState(tab.ownerSessionId, tab.id);
    return this.stateOf(tab);
  }

  setDevToolsViewport(
    tabId: string,
    sessionId: string,
    viewport: BrowserViewport | null,
    covered = false
  ): BrowserTabState {
    const tab = this.tabs.get(tabId);
    if (viewport && tab?.devtoolsOpen) {
      this.shownDevtools = { tabId, sessionId, viewport, covered };
    } else if (this.shownDevtools?.tabId === tabId) {
      this.shownDevtools = null;
    }
    this.layout();
    return this.state(tabId);
  }

  private ensureWorkbenchOnTop(window: BrowserWindow): void {
    const workbench = getWorkbenchView(window);
    if (!workbench) return;
    const bounds = pinnedWorkbenchBounds(window);
    if (bounds) workbench.setBounds(bounds);
    window.contentView.addChildView(workbench);
  }

  /**
   * 层级：workbench（renderer）是一整块 NSView，透明像素照样吃掉 hit-test，
   * 所以 guest 平时必须叠在 workbench 之上才能被用户点；只有 renderer 浮层
   * 压到网页区域时才沉到 index 0，让菜单 / Dialog 透洞盖在网页上。
   */
  private layout(): void {
    const window = this.hostWindow();
    if (!window || window.isDestroyed()) {
      for (const tab of this.tabs.values()) void this.applyEmulation(tab, null).catch(() => {});
      return;
    }
    const { contentView } = window;
    const raise: WebContentsView[] = [];
    for (const tab of this.tabs.values()) {
      const onTop = Boolean(this.shown && tab.id === this.shown.tabId);
      if (!contentView.children.includes(tab.view)) contentView.addChildView(tab.view, 0);
      // 独立窗口里的前端归那扇窗口，不能被主窗口抢回来
      if (tab.devtools && !tab.devtoolsWindow && !contentView.children.includes(tab.devtools)) {
        contentView.addChildView(tab.devtools, 0);
      }
      const dtStage =
        tab.devtools &&
        tab.devtoolsOpen &&
        !tab.devtoolsWindow &&
        this.shownDevtools?.tabId === tab.id
          ? this.shownDevtools
          : null;
      // 停靠：前端铺满舞台、自带拖拽分隔条，网页叠在它给出的区域上（同 Chrome 的嵌入方式）
      const guestBounds =
        dtStage && tab.devtoolsPage
          ? devtoolsGuestBounds(dtStage.viewport, tab.devtoolsPage)
          : dtStage
            ? null
            : (this.shown?.viewport ?? null);
      const guestCovered = Boolean(this.shown?.covered || dtStage?.covered);
      if (dtStage && tab.devtools) {
        tab.devtools.setBounds(dtStage.viewport);
        tab.devtools.setVisible(true);
        if (!dtStage.covered && !this.overlayActive) raise.push(tab.devtools);
      } else if (tab.devtools && !tab.devtoolsWindow) {
        tab.devtools.setVisible(false);
      }
      if (onTop && guestBounds) {
        tab.view.setBounds(guestBounds);
        tab.view.setVisible(true);
        if (!guestCovered && !this.overlayActive) raise.push(tab.view);
      } else {
        tab.view.setVisible(false);
      }
      void this.applyEmulation(tab, onTop && this.shown ? this.shown.viewport : null).catch(
        (error: unknown) => console.warn('[browser] emulation failed', error)
      );
    }
    this.ensureWorkbenchOnTop(window);
    for (const view of raise) contentView.addChildView(view);
  }

  private applyEmulation(tab: Tab, panel: BrowserViewport | null, strict = false): Promise<void> {
    if (!tab.ready || tab.view.webContents.isDestroyed()) return Promise.resolve();
    if (tab.devtoolsOpen) {
      if (strict)
        return Promise.reject(new Error('Close DevTools before changing device emulation'));
      return Promise.resolve();
    }
    const metrics = effectiveBrowserViewport(tab.device, panel);
    const key = JSON.stringify({ device: tab.device, metrics, shown: Boolean(panel) });
    if (tab.emulationKey === key) return tab.emulationQueue;
    tab.emulationKey = key;
    const task = tab.emulationQueue
      .catch(() => {})
      .then(async () => {
        if (tab.emulationKey !== key || this.tabs.get(tab.id) !== tab || tab.devtoolsOpen) return;
        const device = tab.device;
        const commands = device.enabled
          ? [
              {
                method: 'Emulation.setDeviceMetricsOverride',
                params: {
                  width: metrics.width,
                  height: metrics.height,
                  deviceScaleFactor: metrics.deviceScaleFactor,
                  mobile: metrics.mobile,
                  screenWidth: metrics.width,
                  screenHeight: metrics.height,
                  scale: metrics.scale,
                  screenOrientation: {
                    type:
                      device.orientation === 'landscape' ? 'landscapePrimary' : 'portraitPrimary',
                    angle: device.orientation === 'landscape' ? 90 : 0,
                  },
                },
              },
              {
                method: 'Emulation.setTouchEmulationEnabled',
                params: { enabled: metrics.touch, maxTouchPoints: metrics.touch ? 5 : 1 },
              },
              {
                method: 'Emulation.setUserAgentOverride',
                params: {
                  userAgent: metrics.mobile
                    ? `${tab.view.webContents.getUserAgent()} Mobile`
                    : tab.view.webContents.getUserAgent(),
                  userAgentMetadata: {
                    brands: [
                      {
                        brand: 'Chromium',
                        version: process.versions.chrome?.split('.')[0] ?? '130',
                      },
                    ],
                    fullVersionList: [],
                    platform: metrics.mobile ? 'Android' : process.platform,
                    platformVersion: '',
                    architecture: '',
                    model: metrics.mobile ? 'Mobile' : '',
                    mobile: metrics.mobile,
                  },
                },
              },
              { method: 'Emulation.setFocusEmulationEnabled', params: { enabled: !panel } },
            ]
          : [
              ...(panel ? shownTabCdpCommands() : hiddenTabCdpCommands()),
              { method: 'Emulation.setTouchEmulationEnabled', params: { enabled: false } },
              { method: 'Emulation.setUserAgentOverride', params: { userAgent: '' } },
            ];
        for (const command of commands) {
          if (tab.emulationKey !== key || this.tabs.get(tab.id) !== tab || tab.devtoolsOpen) return;
          const result = await this.cdp(tab, command.method, command.params);
          if (result === undefined && strict) {
            tab.emulationKey = undefined;
            throw new Error(`Device emulation failed: ${command.method}`);
          }
        }
      });
    tab.emulationQueue = task;
    return task;
  }

  /** host 内白名单 CDP；模型永远摸不到 */
  private detachDebugger(tab: Tab): void {
    const contents = tab.view.webContents;
    if (contents.isDestroyed()) return;
    const dbg = contents.debugger;
    if (dbg.isAttached()) {
      try {
        dbg.detach();
      } catch {}
    }
    tab.designBinding = false;
  }

  private ensureDevTools(tab: Tab): void {
    const contents = tab.view.webContents;
    if (contents.isDestroyed()) return;
    if (!tab.devtools) {
      tab.devtools = new WebContentsView({
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
      tab.devtools.setBackgroundColor('#202124');
      const devtools = tab.devtools.webContents;
      devtools.once('destroyed', () => {
        if (this.tabs.get(tab.id) !== tab || tab.devtools?.webContents !== devtools) return;
        this.setDevTools(tab.id, false);
      });
      // 前端 undock 时会 window.open 一个空白宿主窗；独立窗口由我们自己开
      devtools.setWindowOpenHandler(() => ({ action: 'deny' }));
      devtools.on('dom-ready', () => {
        void devtools.executeJavaScript(DEVTOOLS_DOCK_BRIDGE_SCRIPT, true).catch(() => {});
      });
      devtools.on('console-message', (details) => {
        if (tab.devtools?.webContents !== devtools) return;
        const message = parseDevtoolsDockMessage(details.message);
        if (message) this.onDevtoolsDock(tab, message);
      });
    }
    const dt = tab.devtools.webContents;
    if (dt.isDestroyed()) return;
    try {
      contents.setDevToolsWebContents(dt);
    } catch {}
    // 停靠模式才会给前端 can_dock=true，菜单里才有「Dock side」；
    // 视图布局仍由我们按前端上报的方向 / 网页区域来摆
    contents.openDevTools({ mode: 'bottom', activate: false });
  }

  /** 必须在 session.fromPartition 之前：Chromium 建 session 时把偏好读进内存，之后改文件无效 */
  private resetUndockedPreference(partition: string): void {
    const file = join(
      app.getPath('userData'),
      'Partitions',
      partition.replace(/^persist:/, ''),
      'Preferences'
    );
    try {
      if (!existsSync(file)) return;
      const next = resetUndockedDevtoolsPreference(readFileSync(file, 'utf8'));
      if (next) writeFileSync(file, next);
    } catch (error) {
      console.warn('[browser] could not reset DevTools dock preference', error);
    }
  }

  private onDevtoolsDock(tab: Tab, message: DevtoolsDockMessage): void {
    if (this.tabs.get(tab.id) !== tab || !tab.devtoolsOpen) return;
    if ('closed' in message) {
      this.setDevTools(tab.id, false);
      return;
    }
    if ('bounds' in message) {
      tab.devtoolsPage = message.bounds;
      this.layout();
      return;
    }
    if (message.side === tab.devtoolsDock) return;
    tab.devtoolsDock = message.side;
    if (message.side === 'undocked') {
      tab.devtoolsPage = null;
      this.openDevtoolsWindow(tab);
    } else {
      this.closeDevtoolsWindow(tab);
    }
    this.layout();
    this.emitState(tab.ownerSessionId, tab.id);
  }

  /** 选「Undock into separate window」：把同一个前端视图挪进独立窗口，关窗即关 DevTools */
  private openDevtoolsWindow(tab: Tab): void {
    const view = tab.devtools;
    if (!view || tab.devtoolsWindow) return;
    const host = this.hostWindow();
    this.detach(view);
    const bounds = host && !host.isDestroyed() ? host.getBounds() : undefined;
    const win = new BrowserWindow({
      width: 960,
      height: 640,
      ...(bounds ? { x: bounds.x + 40, y: bounds.y + 40 } : {}),
      title: `DevTools - ${tab.view.webContents.getURL()}`,
      backgroundColor: '#202124',
      show: false,
    });
    tab.devtoolsWindow = win;
    win.contentView.addChildView(view);
    const syncBounds = () => {
      if (win.isDestroyed()) return;
      const { width, height } = win.getContentBounds();
      view.setBounds({ x: 0, y: 0, width, height });
    };
    syncBounds();
    view.setVisible(true);
    win.on('resize', syncBounds);
    win.on('closed', () => {
      if (tab.devtoolsWindow !== win) return;
      tab.devtoolsWindow = undefined;
      if (this.tabs.get(tab.id) === tab && tab.devtoolsOpen) this.setDevTools(tab.id, false);
    });
    win.show();
  }

  private closeDevtoolsWindow(tab: Tab): void {
    const win = tab.devtoolsWindow;
    if (!win) return;
    tab.devtoolsWindow = undefined;
    if (!win.isDestroyed()) {
      if (tab.devtools && win.contentView.children.includes(tab.devtools))
        win.contentView.removeChildView(tab.devtools);
      win.destroy();
    }
  }

  private teardownDevTools(tab: Tab): void {
    const frontend = tab.devtools;
    this.closeDevtoolsWindow(tab);
    // closeDevTools 会销毁自定义前端；先摘掉引用，避免关闭事件重入或 layout
    // 再把已销毁的 child view 挂回窗口（连后续菜单 covered 上报都会因此失败）。
    tab.devtools = undefined;
    tab.devtoolsPage = null;
    if (this.shownDevtools?.tabId === tab.id) this.shownDevtools = null;
    if (frontend) this.detach(frontend);
    const contents = tab.view.webContents;
    if (!contents.isDestroyed() && contents.isDevToolsOpened()) contents.closeDevTools();
    if (frontend && !frontend.webContents.isDestroyed()) frontend.webContents.close();
  }

  private async cdp(tab: Tab, method: string, params: Record<string, unknown>): Promise<unknown> {
    if (tab.devtoolsOpen) return undefined;
    const contents = tab.view.webContents;
    if (!tab.ready || contents.isDestroyed()) return undefined;
    const dbg = contents.debugger;
    if (!dbg.isAttached()) dbg.attach('1.3');
    return dbg.sendCommand(method, params).catch((error: unknown) => {
      console.warn(`[browser] ${method} failed: ${error instanceof Error ? error.message : error}`);
      return undefined;
    });
  }

  private fileRootFor(sessionId: string): string | undefined {
    return resolveLocalCwdForBrowser(sessionId) ?? undefined;
  }

  private allowUrl(raw: string, sessionId: string): URL {
    return assertBrowserUrl(raw, this.fileRootFor(sessionId));
  }

  /** 面板地址栏 / 按钮 */
  async userNavigate(tabId: string, sessionId: string, raw: string): Promise<void> {
    const existing = this.tabs.get(tabId);
    if (existing && existing.ownerSessionId !== sessionId)
      throw new Error('Browser tab owner mismatch.');
    if (!existing) this.createTab(sessionId, tabId);
    this.currentBySession.set(sessionId, tabId);
    this.userTabs.add(tabId);
    const url = this.allowUrl(raw, sessionId);
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    this.userInteracted(tab);
    await Promise.race([
      tab.view.webContents.loadURL(url.href),
      sleep(NAVIGATE_TIMEOUT_MS).then(() => {
        throw new Error(`Navigation to ${url.href} timed out`);
      }),
    ]);
  }

  goBack(tabId: string): void {
    const tab = this.tabs.get(tabId);
    if (tab?.view.webContents.navigationHistory.canGoBack()) {
      const history = tab.view.webContents.navigationHistory;
      const entry = history.getEntryAtIndex(history.getActiveIndex() - 1);
      if (!entry || !this.canNavigate(tab, entry.url)) return;
      this.userInteracted(tab);
      history.goBack();
    }
  }

  goForward(tabId: string): void {
    const tab = this.tabs.get(tabId);
    if (tab?.view.webContents.navigationHistory.canGoForward()) {
      const history = tab.view.webContents.navigationHistory;
      const entry = history.getEntryAtIndex(history.getActiveIndex() + 1);
      if (!entry || !this.canNavigate(tab, entry.url)) return;
      this.userInteracted(tab);
      history.goForward();
    }
  }

  private canNavigate(tab: Tab, raw: string): boolean {
    try {
      this.allowUrl(raw, tab.ownerSessionId);
      return true;
    } catch {
      return false;
    }
  }

  reload(tabId: string): void {
    const tab = this.tabs.get(tabId);
    if (!tab || !this.canNavigate(tab, tab.view.webContents.getURL())) return;
    this.userInteracted(tab);
    tab.view.webContents.reload();
  }

  async closeTab(tabId: string): Promise<void> {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    this.userTabs.delete(tabId);
    this.forgetTab(tabId);
    await this.destroyTab(tab);
    for (const listener of this.closeListeners) listener(tab.ownerSessionId, tabId);
  }

  async closeSession(sessionId: string): Promise<void> {
    const live = [...this.tabs.values()].filter((tab) => tab.ownerSessionId === sessionId);
    for (const tab of live) await this.closeTab(tab.id);
    this.loadPersisted();
    const next = dropPersistedTabsForSession(this.persisted, sessionId);
    if (Object.keys(next).length !== Object.keys(this.persisted).length) {
      this.persisted = next;
      this.writePersisted();
    }
    this.currentBySession.delete(sessionId);
  }

  /**
   * 兼容 browser_lock 的标签保留标记，不拦截用户输入或阻止 Agent 协作。
   * 保留只作用于目标 tab；无目标的释放覆盖会话下全部 tab。
   */
  async setLocked(sessionId: string, locked: boolean, target?: Tab): Promise<void> {
    const current = target ?? this.mustTab(sessionId);
    if (locked) {
      current.locked = true;
      this.emitState(sessionId, current.id);
      return;
    }
    for (const tab of target ? [target] : this.tabs.values()) {
      if (tab.ownerSessionId !== sessionId) continue;
      tab.locked = false;
      this.emitState(tab.ownerSessionId, tab.id);
    }
  }

  async setDesignMode(tabId: string, enabled: boolean): Promise<BrowserTabState> {
    const tab = this.tabs.get(tabId);
    if (!tab) return EMPTY_STATE;
    if (enabled && tab.devtoolsOpen) return this.stateOf(tab);
    if (!enabled) {
      tab.designMode = false;
      tab.pickSeq += 1;
      await this.runGuest(tab, PAGE_DESIGN_MODE_DISABLE_SCRIPT);
      this.emitState(tab.ownerSessionId, tab.id);
      return this.stateOf(tab);
    }
    await this.ensureDesignBinding(tab);
    await this.runGuest(tab, PAGE_DESIGN_MODE_ENABLE_SCRIPT);
    tab.designMode = true;
    this.emitState(tab.ownerSessionId, tab.id);
    return this.stateOf(tab);
  }

  private emitDesign(event: BrowserDesignModeEvent): void {
    for (const listener of this.designListeners) listener(event);
  }

  private async runGuest(tab: Tab, script: string): Promise<unknown> {
    const contents = tab.view.webContents;
    if (contents.isDestroyed() || !tab.ready) return undefined;
    return contents.executeJavaScript(script, true).catch(() => undefined);
  }

  private async ensureDesignBinding(tab: Tab): Promise<void> {
    if (tab.designBinding && tab.view.webContents.debugger.isAttached()) return;
    const contents = tab.view.webContents;
    if (contents.isDestroyed() || !tab.ready) return;
    const dbg = contents.debugger;
    if (!dbg.isAttached()) {
      try {
        dbg.attach('1.3');
      } catch {
        return;
      }
    }
    dbg.on('message', (_event, method, params) => {
      if (method !== 'Runtime.bindingCalled') return;
      const name = isRecord(params) ? params.name : undefined;
      const payload = isRecord(params) ? params.payload : undefined;
      if (name !== DESIGN_MODE_BINDING || typeof payload !== 'string') return;
      void this.onDesignBinding(tab, payload);
    });
    await this.cdp(tab, 'Runtime.addBinding', { name: DESIGN_MODE_BINDING });
    tab.designBinding = true;
  }

  private async onDesignBinding(tab: Tab, raw: string): Promise<void> {
    if (!tab.designMode) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    const msg = parseDesignBinding(parsed);
    if (!msg) return;
    if (msg.type === 'cancelled') {
      await this.setDesignMode(tab.id, false);
      this.emitDesign({ type: 'cancelled', conversationId: tab.ownerSessionId, tabId: tab.id });
      return;
    }
    if (msg.type === 'freeze-request') {
      await this.runGuest(tab, PAGE_DESIGN_MODE_HIDE_SCRIPT);
      try {
        const shot = await this.screenshotClip(tab, undefined, { captureBeyondViewport: false });
        await this.runGuest(tab, pageDesignModeShowFrozenScript(shot.data));
      } catch {
        await this.runGuest(tab, pageDesignModeShowFrozenScript(''));
      }
      return;
    }
    if (msg.type === 'annotated') {
      const seq = ++tab.pickSeq;
      const composed = await this.runGuest(tab, PAGE_DESIGN_MODE_COMPOSE_SCRIPT);
      if (seq !== tab.pickSeq) return;
      const data = typeof composed === 'string' ? composed : '';
      if (!data) return;
      await this.setDesignMode(tab.id, false);
      this.emitDesign({
        type: 'annotated',
        conversationId: tab.ownerSessionId,
        tabId: tab.id,
        payload: { label: 'annotation', path: 'scribble', text: '' },
        image: { data, mimeType: 'image/png' },
      });
      return;
    }
    if (msg.type !== 'picked') return;
    const payload = sanitizeUiElementPayload(msg.payload);
    if (!payload) return;
    const seq = ++tab.pickSeq;
    await this.runGuest(tab, PAGE_DESIGN_MODE_HIDE_SCRIPT);
    let image: { data: string; mimeType: string } | undefined;
    try {
      image = await this.screenshotRect(tab, payload.rect);
    } catch {}
    if (seq !== tab.pickSeq) return;
    await this.setDesignMode(tab.id, false);
    this.emitDesign({
      type: 'picked',
      conversationId: tab.ownerSessionId,
      tabId: tab.id,
      payload,
      ...(image ? { image } : {}),
    });
  }

  private async screenshotRect(
    tab: Tab,
    rect?: { x: number; y: number; width: number; height: number }
  ): Promise<{ data: string; mimeType: string }> {
    if (
      rect &&
      Number.isFinite(rect.width) &&
      Number.isFinite(rect.height) &&
      rect.width >= 1 &&
      rect.height >= 1
    ) {
      return this.screenshotClip(tab, {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        scale: 1,
      });
    }
    return this.screenshot(tab);
  }

  getSession(): Session {
    if (!this.guestSession) {
      const name = partitionName(app.isPackaged);
      this.resetUndockedPreference(name);
      this.guestSession = session.fromPartition(name);
      void import('./proxyConfig').then(({ getProxyConfig }) =>
        getProxyConfig().attachSession(this.guestSession as Session)
      );
      // guest 页拿不到摄像头 / 通知 / 地理位置等；只放剪贴板写
      this.guestSession.setPermissionRequestHandler((_wc, permission, callback) =>
        callback(permission === 'clipboard-sanitized-write')
      );
      this.guestSession.setPermissionCheckHandler(
        (_wc, permission) => permission === 'clipboard-sanitized-write'
      );
      // Also covers frames, subresources, reload and network-backed history loads.
      this.guestSession.webRequest.onBeforeRequest(
        { urls: ['file://*/*'] },
        (details, callback) => {
          const tab = [...this.tabs.values()].find(
            (entry) => entry.view.webContents.id === details.webContentsId
          );
          try {
            if (!tab) throw new Error('Unknown file request owner');
            this.allowUrl(details.url, tab.ownerSessionId);
            callback({ cancel: false });
          } catch {
            callback({ cancel: true });
          }
        }
      );
    }
    return this.guestSession;
  }

  async invoke(
    sessionId: string,
    op: BrowserOp,
    params: unknown,
    actor?: BrowserActor,
    options?: { signal?: AbortSignal }
  ): Promise<unknown> {
    options?.signal?.throwIfAborted();
    if (op === 'history') return this.history(sessionId, params);
    if (op === 'downloads') return this.downloads(sessionId, params);
    if (actor && this.tabClaims.takeClosed(actor.sessionId))
      throw new Error(BROWSER_TAB_CLOSED_NOTICE);
    const explicit =
      isRecord(params) && params.tabId !== undefined ? paramString(params, 'tabId') : undefined;
    if (explicit) this.ownedTab(explicit, sessionId);
    if (op === 'tabs') {
      return this.handleTabs(
        sessionId,
        isRecord(params) && typeof params.action === 'string' ? params.action : 'list',
        isRecord(params) && typeof params.index === 'number' ? params.index : undefined,
        actor,
        explicit
      );
    }
    const pointed = actor ? this.tabClaims.pointer(actor.sessionId) : undefined;
    const newTab = op === 'navigate' && isRecord(params) && params.newTab === true;
    let tab = explicit
      ? this.ownedTab(explicit, sessionId)
      : newTab
        ? undefined
        : ((pointed ? this.tabs.get(pointed) : undefined) ?? this.agentTabFor(sessionId));
    if (
      !tab &&
      (op === 'navigate' || (op === 'navigation' && isRecord(params) && params.action === 'search'))
    )
      tab = this.createTab(sessionId);
    if (!tab) throw new Error('No browser tab is open. Call browser_navigate first.');
    const target = this.ownedTab(tab.id, sessionId);
    // 工具一旦选定 tab，后续不带 tabId 的调用都跟随它；UI 面板可见性不得改写这个指针
    this.agentBySession.set(sessionId, target.id);
    if (actor) {
      const claim = this.tabClaims.claim(target.id, actor);
      if (!claim.ok) throw new Error(browserTabBusyMessage(claim.holder.name));
      if (target.lastHolder !== actor.sessionId) this.invalidateRefs(target);
      target.lastHolder = actor.sessionId;
    }
    let draining: Promise<unknown> | undefined;
    const task = target.queue
      .catch(() => {})
      .then(async () => {
        this.assertTabActive(target);
        options?.signal?.throwIfAborted();
        const controller = new AbortController();
        const signal = options?.signal
          ? AbortSignal.any([controller.signal, options.signal])
          : controller.signal;
        target.active = controller;
        target.operationSignal = signal;
        let running: Promise<unknown> | undefined;
        let settled = false;
        let graceTimer: ReturnType<typeof setTimeout> | undefined;
        let recovered!: () => void;
        const recovery = new Promise<void>((resolve) => {
          recovered = resolve;
        });
        let removeAbort = () => {};
        const aborted = new Promise<never>((_resolve, reject) => {
          const abort = () => {
            if (!settled && !graceTimer) {
              graceTimer = setTimeout(() => {
                // 不能在旧任务仍可能发输入时复用 tab；超时只能关闭它后回收队列。
                if (this.tabs.get(target.id) !== target) {
                  recovered();
                  return;
                }
                void this.closeTab(target.id)
                  .catch(() => {})
                  .finally(recovered);
              }, ABORT_GRACE_MS);
            }
            try {
              const contents = target.view.webContents;
              if ((op === 'navigate' || op === 'navigation') && !contents.isDestroyed())
                contents.stop();
            } catch {
              // webContents 可能在取消同时销毁，不能让 abort listener 抛到 Main。
            } finally {
              reject(signal.reason ?? new Error('Browser operation aborted'));
            }
          };
          signal.addEventListener('abort', abort, { once: true });
          removeAbort = () => signal.removeEventListener('abort', abort);
          if (signal.aborted) abort();
        });
        try {
          running = this.run(sessionId, op, params, () => target, target).finally(() => {
            settled = true;
            clearTimeout(graceTimer);
            // 取消只提前结束调用者等待；底层工作退出前保留自己的 signal 与队列槽位，
            // 防止迟到的点击/输入读到下一次操作的 signal 后继续执行。
            if (target.active === controller) {
              target.active = undefined;
              target.operationSignal = undefined;
            }
          });
          draining = Promise.race([running, recovery]);
          // 调用者可能已经取消；独立的 drain 仍须消费底层任务的迟到失败。
          void draining.catch(() => {});
          const result = await Promise.race([running, aborted]);
          if (op !== 'close') this.assertTabActive(target);
          if (op === 'close' && actor) this.tabClaims.takeClosed(actor.sessionId);
          return result;
        } finally {
          removeAbort();
          if (target.active === controller && !running) {
            clearTimeout(graceTimer);
            target.active = undefined;
            target.operationSignal = undefined;
          }
        }
      });
    target.queue = task
      .catch(() => {})
      .then(() => draining)
      .catch(() => {});
    const externalSignal = options?.signal;
    if (!externalSignal) return task;
    let removeExternalAbort = () => {};
    const externalAbort = new Promise<never>((_resolve, reject) => {
      const abort = () => reject(externalSignal.reason ?? new Error('Browser operation aborted'));
      externalSignal.addEventListener('abort', abort, { once: true });
      removeExternalAbort = () => externalSignal.removeEventListener('abort', abort);
      if (externalSignal.aborted) abort();
    });
    try {
      // 排队阶段也必须立即响应调用者取消；队列任务稍后检查 signal，不执行动作。
      return await Promise.race([task, externalAbort]);
    } finally {
      removeExternalAbort();
    }
  }

  private assertTabActive(tab: Tab): void {
    if (this.tabs.get(tab.id) !== tab) throw new Error('Browser tab is closed');
    tab.operationSignal?.throwIfAborted();
  }

  private assertSnapshotCurrent(tab: Tab, generation: number): void {
    this.assertTabActive(tab);
    if (generation !== tab.generation)
      throw new Error('Page changed while reading; refresh browser_snapshot or browser_read.');
  }

  private async run(
    sessionId: string,
    op: BrowserOp,
    params: unknown,
    mustTab: () => Tab,
    navigateTab?: Tab
  ): Promise<unknown> {
    switch (op) {
      case 'read_text':
        return this.readPage(mustTab(), params, 'text');
      case 'read_elements':
        return this.readPage(mustTab(), params, 'elements');
      case 'device':
        return this.setDevice(
          mustTab().id,
          sessionId,
          isRecord(params) ? params.device : undefined
        );
      case 'wait':
        return this.waitFor(mustTab(), params);
      case 'hover':
        return this.pointer(mustTab(), paramString(params, 'ref'), false);
      case 'set_checked': {
        if (!isRecord(params) || typeof params.checked !== 'boolean')
          throw new Error('checked must be boolean');
        return this.setChecked(mustTab(), paramString(params, 'ref'), params.checked);
      }
      case 'scroll_into_view':
        return this.runPage(
          mustTab(),
          pageScrollIntoViewScript(paramString(params, 'ref')),
          paramString(params, 'ref')
        );
      case 'navigation':
        return this.navigation(mustTab(), params);
      case 'history':
        return this.history(sessionId, params);
      case 'downloads':
        return this.downloads(sessionId, params);
      case 'navigate':
        return this.navigate(
          sessionId,
          paramString(params, 'url'),
          isRecord(params) && params.newTab === true,
          navigateTab
        );
      case 'snapshot':
        return this.snapshot(mustTab());
      case 'click':
        return this.click(mustTab(), paramString(params, 'ref'));
      case 'type': {
        const text = isRecord(params) && typeof params.text === 'string' ? params.text : '';
        const submit = isRecord(params) && params.submit === true;
        return this.type(mustTab(), paramString(params, 'ref'), text, submit);
      }
      case 'fill':
        return this.type(
          mustTab(),
          paramString(params, 'ref'),
          isRecord(params) && typeof params.value === 'string'
            ? params.value
            : isRecord(params) && typeof params.text === 'string'
              ? params.text
              : '',
          false
        );
      case 'press_key':
        return this.pressKey(mustTab(), paramString(params, 'key'));
      case 'scroll':
        return this.runPage(
          mustTab(),
          pageScrollScript({
            ...(isRecord(params) && typeof params.ref === 'string' ? { ref: params.ref } : {}),
            ...(isRecord(params) && typeof params.direction === 'string'
              ? { direction: params.direction }
              : {}),
            ...(isRecord(params) && typeof params.amount === 'number'
              ? { amount: params.amount }
              : {}),
          })
        );
      case 'select_option': {
        const values =
          isRecord(params) && Array.isArray(params.values)
            ? params.values.filter((v): v is string => typeof v === 'string')
            : isRecord(params) && typeof params.value === 'string'
              ? [params.value]
              : [];
        return this.selectOption(mustTab(), paramString(params, 'ref'), values);
      }
      case 'click_xy': {
        const x = isRecord(params) ? Number(params.x) : Number.NaN;
        const y = isRecord(params) ? Number(params.y) : Number.NaN;
        if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('x and y are required');
        return this.runPage(mustTab(), pageClickXyScript(x, y));
      }
      case 'drag':
        return this.drag(mustTab(), params);
      case 'highlight':
        return this.runPage(
          mustTab(),
          pageHighlightScript(paramString(params, 'ref')),
          paramString(params, 'ref')
        );
      case 'bounding_box':
        return this.boundingBox(mustTab(), paramString(params, 'ref'));
      case 'screenshot':
        return this.screenshot(
          mustTab(),
          isRecord(params) && typeof params.ref === 'string' ? params.ref : undefined
        );
      case 'cdp':
        return this.cdpCommand(
          mustTab(),
          paramString(params, 'method'),
          isRecord(params) && isRecord(params.params) ? params.params : {}
        );
      case 'close': {
        const tab = mustTab();
        await this.closeTab(tab.id);
        return { closed: tab.id };
      }
      case 'tabs':
        return this.handleTabs(
          sessionId,
          isRecord(params) && typeof params.action === 'string' ? params.action : 'list',
          isRecord(params) && typeof params.index === 'number' ? params.index : undefined
        );
      case 'lock': {
        const locked = !(isRecord(params) && params.release === true);
        const targeted = locked || (isRecord(params) && params.tabId !== undefined);
        await this.setLocked(sessionId, locked, targeted ? mustTab() : undefined);
        return { locked: mustTab().locked };
      }
    }
  }

  private tabsForSession(sessionId: string): Tab[] {
    return [...this.tabs.values()]
      .filter((tab) => tab.ownerSessionId === sessionId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  private async handleTabs(
    sessionId: string,
    action: string,
    index?: number,
    actor?: BrowserActor,
    tabId?: string
  ): Promise<unknown> {
    if (!['new', 'select', 'close', 'list'].includes(action))
      throw new Error('Invalid tabs action');
    const list = () => {
      const current =
        (actor && this.tabClaims.pointer(actor.sessionId)) ?? this.agentBySession.get(sessionId);
      return this.tabsForSession(sessionId).map((tab, tabIndex) => ({
        index: tabIndex,
        ...this.stateOf(tab),
        active: tab.id === current,
      }));
    };
    if (action === 'new') {
      const tab = this.createTab(sessionId);
      if (actor) this.tabClaims.claim(tab.id, actor);
      this.agentBySession.set(sessionId, tab.id);
      this.userTabs.add(tab.id);
      this.requestReveal(sessionId, tab.id);
      return { opened: tab.id, tabs: list() };
    }
    if (action === 'select') {
      if (!tabId && (index === undefined || !Number.isInteger(index)))
        throw new Error('tabId or index is required for select');
      const tab = tabId
        ? this.ownedTab(tabId, sessionId)
        : this.tabsForSession(sessionId)[index ?? -1];
      if (!tab) throw new Error(`No browser tab at index ${index}`);
      this.currentBySession.set(sessionId, tab.id);
      this.agentBySession.set(sessionId, tab.id);
      if (actor) this.tabClaims.point(actor.sessionId, tab.id);
      this.requestReveal(sessionId, tab.id);
      return { selected: tab.id, tabs: list() };
    }
    if (action === 'close') {
      const tabs = this.tabsForSession(sessionId);
      const pointed = actor ? this.tabClaims.pointer(actor.sessionId) : undefined;
      const tab =
        index === undefined
          ? ((pointed ? this.tabs.get(pointed) : undefined) ?? this.tabFor(sessionId))
          : tabs[index];
      if (!tab) throw new Error('No browser tab to close');
      if (actor) {
        const claim = this.tabClaims.claim(tab.id, actor);
        if (!claim.ok) throw new Error(browserTabBusyMessage(claim.holder.name));
      }
      await this.closeTab(tab.id);
      if (actor) this.tabClaims.takeClosed(actor.sessionId);
      return { closed: tab.id, tabs: list() };
    }
    return { tabs: list() };
  }

  async navigate(sessionId: string, raw: string, newTab = false, target?: Tab): Promise<PageInfo> {
    const url = this.allowUrl(raw, sessionId);
    const tab =
      target ??
      (newTab ? this.createTab(sessionId) : (this.tabFor(sessionId) ?? this.createTab(sessionId)));
    const contents = tab.view.webContents;
    tab.lastSnapshot = undefined;
    await Promise.race([
      contents.loadURL(url.href),
      sleep(NAVIGATE_TIMEOUT_MS).then(() => {
        throw new Error(`Navigation to ${url.href} timed out`);
      }),
    ]);
    this.requestReveal(sessionId, tab.id);
    return this.pageInfo(contents);
  }

  private async readPage(tab: Tab, params: unknown, kind: 'text' | 'elements'): Promise<unknown> {
    const request = parseReadRequest(params);
    const key = JSON.stringify({
      scope: request.scope ?? 'viewport',
      ref: request.ref,
      role: request.role,
      text: request.text,
      kind,
    });
    if (request.cursor) {
      if (!tab.readSnapshot || tab.readKey !== key) throw new Error('Stale or invalid read cursor');
    } else {
      if (request.ref) this.assertRef(tab, request.ref);
      const generation = tab.generation;
      const snapshotId = `${tab.id.replace(/[^a-z0-9-]/gi, '').slice(-40)}-${++tab.snapshotSeq}`;
      const raw = await tab.view.webContents.executeJavaScript(
        pageReadScript(request, snapshotId),
        true
      );
      this.assertSnapshotCurrent(tab, generation);
      const snapshot = parsePageReadSnapshot(raw, snapshotId);
      this.invalidateRefs(tab);
      tab.readSnapshot = snapshot;
      tab.readKey = key;
      tab.lastSnapshot = renderSnapshot(this.pageInfo(tab.view.webContents), snapshot.entries);
    }
    if (!tab.readSnapshot) throw new Error('Read snapshot unavailable');
    return {
      ...this.pageInfo(tab.view.webContents),
      tabId: tab.id,
      ...readPageSlice(tab.readSnapshot, request, kind),
    };
  }

  private async snapshot(tab: Tab): Promise<string> {
    const generation = tab.generation;
    const prefix = `${tab.id.replace(/[^a-z0-9-]/gi, '').slice(-40)}-${++tab.snapshotSeq}`;
    const script = PAGE_SNAPSHOT_SCRIPT.replace(
      "const ref = 'e' + (++counter);",
      `const ref = 'e' + ${JSON.stringify(prefix)} + '_' + (++counter);`
    );
    const raw: unknown = await tab.view.webContents.executeJavaScript(script, true);
    this.assertSnapshotCurrent(tab, generation);
    const entries = parseSnapshotEntries(raw);
    if (!entries) throw new Error('Page snapshot returned an unexpected shape.');
    this.invalidateRefs(tab);
    tab.lastSnapshot = renderSnapshot(this.pageInfo(tab.view.webContents), entries);
    return tab.lastSnapshot.text;
  }

  private sendInput(tab: Tab, event: Electron.KeyboardInputEvent | Electron.MouseInputEvent): void {
    this.assertTabActive(tab);
    tab.synthetic += 1;
    try {
      tab.view.webContents.sendInputEvent(event);
    } finally {
      tab.synthetic -= 1;
    }
  }

  private async pressKey(tab: Tab, key: string): Promise<PageInfo> {
    const { keyCode, modifiers: rawModifiers } = parseBrowserKey(key);
    const modifiers = rawModifiers as NonNullable<Electron.KeyboardInputEvent['modifiers']>;
    this.sendInput(tab, { type: 'keyDown', keyCode, modifiers });
    if (keyCode.length === 1 && rawModifiers.length === 0)
      this.sendInput(tab, { type: 'char', keyCode });
    this.sendInput(tab, { type: 'keyUp', keyCode, modifiers });
    await sleep(40);
    this.assertTabActive(tab);
    return this.pageInfo(tab.view.webContents);
  }

  private async pointer(tab: Tab, ref: string, click: boolean): Promise<PageInfo> {
    this.assertRef(tab, ref);
    const point: unknown = await tab.view.webContents.executeJavaScript(
      pagePrepareInputScript(ref),
      true
    );
    this.assertTabActive(tab);
    this.assertRef(tab, ref);
    if (!isRecord(point) || typeof point.x !== 'number' || typeof point.y !== 'number')
      throw interpretPageAction(ref, point) ?? new Error('Invalid target point');
    await this.pointerAt(tab, point.x, point.y, click);
    return this.pageInfo(tab.view.webContents);
  }

  private async pointerAt(tab: Tab, x: number, y: number, click: boolean): Promise<void> {
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0)
      throw new Error('Invalid pointer coordinates');
    this.sendInput(tab, { type: 'mouseMove', x, y });
    if (click) {
      this.sendInput(tab, { type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
      this.sendInput(tab, { type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
    }
    await sleep(40);
    this.assertTabActive(tab);
  }

  private click(tab: Tab, ref: string): Promise<PageInfo> {
    return this.pointer(tab, ref, true);
  }

  private async type(tab: Tab, ref: string, text: string, submit: boolean): Promise<PageInfo> {
    this.assertRef(tab, ref);
    const prepared: unknown = await tab.view.webContents.executeJavaScript(
      pagePrepareInputScript(ref, true),
      true
    );
    this.assertTabActive(tab);
    this.assertRef(tab, ref);
    if (!isRecord(prepared))
      throw interpretPageAction(ref, prepared) ?? new Error('Could not focus input');
    await this.pressKey(tab, process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    this.assertRef(tab, ref);
    await this.pressKey(tab, 'Backspace');
    this.assertTabActive(tab);
    this.assertRef(tab, ref);
    tab.synthetic += 1;
    try {
      await tab.view.webContents.insertText(text);
    } finally {
      tab.synthetic -= 1;
    }
    this.assertTabActive(tab);
    if (submit) await this.pressKey(tab, 'Enter');
    return this.pageInfo(tab.view.webContents);
  }

  private async setChecked(tab: Tab, ref: string, checked: boolean): Promise<PageInfo> {
    this.assertRef(tab, ref);
    const before: unknown = await tab.view.webContents.executeJavaScript(
      pageCheckedScript(ref),
      true
    );
    if (typeof before !== 'boolean')
      throw interpretPageAction(ref, before) ?? new Error('Element is not checkable');
    if (before !== checked) await this.click(tab, ref);
    this.assertTabActive(tab);
    const after: unknown = await tab.view.webContents.executeJavaScript(
      pageCheckedScript(ref),
      true
    );
    if (after !== checked)
      throw new Error('Click delivered but checked state was not confirmed; do not blindly retry');
    return this.pageInfo(tab.view.webContents);
  }

  private async waitFor(tab: Tab, params: unknown): Promise<unknown> {
    const request = parseBrowserWait(params);
    if (request.ref) this.assertRef(tab, request.ref);
    const deadline = Date.now() + request.timeoutMs;
    do {
      this.assertTabActive(tab);
      if (request.ref) this.assertRef(tab, request.ref);
      const matched: unknown = await tab.view.webContents.executeJavaScript(
        pageWaitScript(request),
        true
      );
      this.assertTabActive(tab);
      if (request.ref) this.assertRef(tab, request.ref);
      if (matched === true) return { matched: true, ...this.stateOf(tab) };
      await sleep(Math.min(100, Math.max(1, deadline - Date.now())));
    } while (Date.now() < deadline);
    throw new Error(`Browser wait timed out after ${request.timeoutMs}ms`);
  }

  private async navigation(tab: Tab, params: unknown): Promise<unknown> {
    const action = paramString(params, 'action');
    const contents = tab.view.webContents;
    if (action === 'search')
      return this.navigate(
        tab.ownerSessionId,
        `https://www.google.com/search?q=${encodeURIComponent(paramString(params, 'query'))}`,
        false,
        tab
      );
    if (action === 'reveal') this.requestReveal(tab.ownerSessionId, tab.id);
    else if (action === 'stop') contents.stop();
    else if (action === 'reload') {
      if (!contents.getURL())
        throw new Error('This browser tab has no page loaded yet; call browser_navigate first.');
      if (!this.canNavigate(tab, contents.getURL()))
        throw new Error('Navigation URL is not allowed');
      this.invalidateRefs(tab);
      contents.reload();
    } else if (action === 'back' || action === 'forward') {
      const history = contents.navigationHistory;
      const delta = action === 'back' ? -1 : 1;
      const entry = history.getEntryAtIndex(history.getActiveIndex() + delta);
      if (entry && this.canNavigate(tab, entry.url)) {
        this.invalidateRefs(tab);
        if (delta === -1) history.goBack();
        else history.goForward();
      }
    } else throw new Error('Invalid navigation action');
    return this.stateOf(tab);
  }

  private async runPage(tab: Tab, script: string, ref?: string): Promise<PageInfo> {
    if (ref) this.assertRef(tab, ref);
    const outcome: unknown = await tab.view.webContents.executeJavaScript(script, true);
    const error = interpretPageAction(ref ?? '', outcome);
    if (error) throw error;
    return this.pageInfo(tab.view.webContents);
  }

  private async selectOption(tab: Tab, ref: string, values: string[]): Promise<PageInfo> {
    this.assertRef(tab, ref);
    const outcome: unknown = await tab.view.webContents.executeJavaScript(
      pageSelectOptionScript(ref, values),
      true
    );
    if (outcome === 'stale') throw staleRef(ref);
    if (outcome !== 'ok') throw new Error(`Could not select option on ${ref}`);
    return this.pageInfo(tab.view.webContents);
  }

  private async boundingBox(tab: Tab, ref: string): Promise<unknown> {
    this.assertRef(tab, ref);
    const box: unknown = await tab.view.webContents.executeJavaScript(
      pageBoundingBoxScript(ref),
      true
    );
    if (!box) throw staleRef(ref);
    return box;
  }

  private async drag(tab: Tab, params: unknown): Promise<PageInfo> {
    const fromRef =
      isRecord(params) && typeof params.fromRef === 'string' ? params.fromRef : undefined;
    const toRef = isRecord(params) && typeof params.toRef === 'string' ? params.toRef : undefined;
    const fromX = isRecord(params) ? Number(params.fromX) : Number.NaN;
    const fromY = isRecord(params) ? Number(params.fromY) : Number.NaN;
    const toX = isRecord(params) ? Number(params.toX) : Number.NaN;
    const toY = isRecord(params) ? Number(params.toY) : Number.NaN;
    const from = fromRef ? { ref: fromRef } : { x: fromX, y: fromY };
    const to = toRef ? { ref: toRef } : { x: toX, y: toY };
    if (fromRef) this.assertRef(tab, fromRef);
    if (toRef) this.assertRef(tab, toRef);
    const contents = tab.view.webContents;
    let pressed: { x: number; y: number } | undefined;
    try {
      const raw: unknown = await contents.executeJavaScript(pageDragPointsScript(from, to), true);
      if (raw === 'stale' || !isRecord(raw) || !isRecord(raw.from) || !isRecord(raw.to)) {
        throw new Error('Drag source or target ref is stale.');
      }
      const startX = Number(raw.from.x);
      const startY = Number(raw.from.y);
      const endX = Number(raw.to.x);
      const endY = Number(raw.to.y);
      if (![startX, startY, endX, endY].every(Number.isFinite)) throw new Error('Drag failed.');
      for (const event of dragInputEvents({ x: startX, y: startY }, { x: endX, y: endY })) {
        this.sendInput(tab, event);
        pressed = event.type === 'mouseUp' ? undefined : { x: event.x, y: event.y };
        await sleep(16);
      }
      await sleep(40);
    } finally {
      // 取消也必须抬起已按下的鼠标；这是释放输入状态，不是继续自动操作。
      if (pressed && !contents.isDestroyed()) {
        tab.synthetic += 1;
        try {
          contents.sendInputEvent({ type: 'mouseUp', ...pressed, button: 'left', clickCount: 1 });
        } finally {
          tab.synthetic -= 1;
        }
      }
      await contents.executeJavaScript(PAGE_SETTLE_FRAMES_SCRIPT, true);
    }
    return this.pageInfo(tab.view.webContents);
  }

  private async cdpCommand(
    tab: Tab,
    method: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    assertDevtoolsIdle(tab.devtoolsOpen);
    assertAllowedCdpMethod(method);
    tab.synthetic += 1;
    const result = await this.cdp(tab, method, params).finally(() => {
      tab.synthetic -= 1;
    });
    if (result === undefined) {
      throw new Error(`CDP method ${method} returned no result`);
    }
    return result;
  }

  /**
   * 被 renderer 盖住的 view `capturePage` 会报 UnknownVizError（合成器不出帧）。
   * 走 CDP `Page.captureScreenshot` + captureBeyondViewport 强制 Blink 离屏渲染。
   * debugger 只在 host 内用，模型摸不到。
   */
  private async screenshot(tab: Tab, ref?: string): Promise<{ data: string; mimeType: string }> {
    assertDevtoolsIdle(tab.devtoolsOpen);
    let clip: PageScreenshotClip;
    if (ref) {
      this.assertRef(tab, ref);
      const box = (await tab.view.webContents.executeJavaScript(
        pageBoundingBoxScript(ref),
        true
      )) as { x: number; y: number; width: number; height: number } | null;
      if (!box) throw staleRef(ref);
      clip = {
        x: box.x,
        y: box.y,
        width: Math.max(1, box.width),
        height: Math.max(1, box.height),
        scale: 1,
      };
    } else {
      const bounds = tab.view.getBounds();
      const width = bounds.width || HEADLESS_BOUNDS.width;
      const height = bounds.height || HEADLESS_BOUNDS.height;
      const scale = width > SCREENSHOT_MAX_WIDTH ? SCREENSHOT_MAX_WIDTH / width : 1;
      clip = { x: 0, y: 0, width, height, scale };
    }
    return this.screenshotClip(tab, clip);
  }

  private async screenshotClip(
    tab: Tab,
    clip?: PageScreenshotClip,
    opts?: { captureBeyondViewport?: boolean }
  ): Promise<{ data: string; mimeType: string }> {
    assertDevtoolsIdle(tab.devtoolsOpen);
    const shot = (await this.cdp(
      tab,
      'Page.captureScreenshot',
      pageScreenshotCdpParams(clip, opts)
    )) as { data?: unknown } | undefined;
    if (typeof shot?.data !== 'string' || !shot.data) {
      throw new Error('Screenshot is empty; the page has not painted yet.');
    }
    return { data: shot.data, mimeType: 'image/png' };
  }

  private assertRef(tab: Tab, ref: string): void {
    if (!isKnownRef(tab.lastSnapshot, ref)) throw staleRef(ref);
  }

  private pageInfo(contents: WebContents): PageInfo {
    return { url: contents.getURL(), title: contents.getTitle() };
  }

  private tabFor(sessionId: string): Tab | undefined {
    const id = this.currentBySession.get(sessionId);
    return id ? this.tabs.get(id) : undefined;
  }

  /** agent 视角的当前 tab：只由工具自己选定/显式 tabId 更新，UI 面板上报不改它 */
  private agentTabFor(sessionId: string): Tab | undefined {
    const id = this.agentBySession.get(sessionId);
    return (id ? this.tabs.get(id) : undefined) ?? this.tabFor(sessionId);
  }

  private mustTab(sessionId: string): Tab {
    const tab = this.agentTabFor(sessionId);
    if (!tab) throw new Error('No browser tab is open. Call browser_navigate first.');
    return tab;
  }

  private createTab(sessionId: string, tabId?: string): Tab {
    this.evictIfNeeded();
    const view = new WebContentsView({
      webPreferences: {
        session: this.getSession(),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    // 默认透明会透过无边框窗口看到桌面；导航空白帧要垫一层不透明底
    view.setBackgroundColor('#ffffff');
    const id = tabId ?? `browser:${++this.counter}-${Date.now().toString(36)}`;
    const tab: Tab = {
      id,
      view,
      ownerSessionId: sessionId,
      createdAt: Date.now(),
      locked: false,
      ready: false,
      devtoolsOpen: false,
      devtoolsDock: 'bottom',
      devtoolsPage: null,
      designMode: false,
      favicon: null,
      pickSeq: 0,
      synthetic: 0,
      device: { enabled: false },
      generation: 0,
      snapshotSeq: 0,
      queue: Promise.resolve(),
      emulationQueue: Promise.resolve(),
    };
    const contents = view.webContents;
    const push = () => this.emitState(sessionId, id);
    // 人工操作只让旧引用失效，不取消协作等待或锁死后续 Agent 工具。
    contents.on('input-event', (_event, input) => {
      if (tab.synthetic === 0 && USER_INPUT.has(input.type)) this.userInteracted(tab);
    });
    contents.on('did-start-loading', push);
    contents.on('did-stop-loading', push);
    // replaceState / hash 也可能来自 Agent 输入；真实人工输入和工具栏单独失效引用。
    contents.on('did-navigate-in-page', push);
    contents.on('page-title-updated', push);
    contents.on('devtools-closed', () => {
      if (this.tabs.get(id) === tab && !contents.isDestroyed() && !contents.isDevToolsOpened())
        this.setDevTools(id, false);
    });
    // 页内链接 / 重定向也过同一道 URL 门
    const guard = (event: { preventDefault(): void }, url: string) => {
      try {
        this.allowUrl(url, sessionId);
      } catch {
        event.preventDefault();
      }
    };
    contents.on('will-navigate', guard);
    contents.on('will-frame-navigate', (event) => guard(event, event.url));
    contents.on('will-redirect', guard);
    contents.on('page-favicon-updated', (_event, urls) => {
      tab.favicon = pickFaviconUrl(urls);
      push();
    });
    let wasFilePage = false;
    contents.on('did-navigate', () => {
      const isFilePage = contents.getURL().startsWith('file:');
      // File entries must never be restored from Chromium's back/forward cache after
      // a workspace or symlink changes. HTTP-only browsing keeps its history.
      if (wasFilePage || isFilePage) contents.navigationHistory.clear();
      wasFilePage = isFilePage;
      this.userInteracted(tab);
      tab.favicon = null;
      push();
    });
    contents.on('did-finish-load', () => {
      // 只清理旧版或 BFCache 残留的锁页遮罩，不再创建。
      void this.runGuest(tab, PAGE_UNLOCK_OVERLAY_SCRIPT);
      if (tab.designMode) void this.runGuest(tab, PAGE_DESIGN_MODE_ENABLE_SCRIPT);
    });
    contents.once('dom-ready', () => {
      tab.ready = true;
      this.layout();
      void this.runGuest(tab, PAGE_UNLOCK_OVERLAY_SCRIPT);
      if (tab.designMode) void this.runGuest(tab, PAGE_DESIGN_MODE_ENABLE_SCRIPT);
    });
    // window.open / target=_blank：本 tab 内导航，不弹系统浏览器
    contents.setWindowOpenHandler(({ url }) => {
      try {
        void contents.loadURL(this.allowUrl(url, sessionId).href).catch(() => {});
      } catch {}
      return { action: 'deny' };
    });
    contents.on('destroyed', () => {
      this.tabs.delete(id);
      this.tabClaims.closeTab(id);
      if (this.currentBySession.get(sessionId) === id) this.currentBySession.delete(sessionId);
      if (this.agentBySession.get(sessionId) === id) this.agentBySession.delete(sessionId);
      this.emitState(sessionId, id);
    });
    this.tabs.set(id, tab);
    this.currentBySession.set(sessionId, id);
    this.layout();
    this.emitState(sessionId, id);
    return tab;
  }

  private detach(view: WebContentsView): void {
    const window = this.hostWindow();
    if (!window || window.isDestroyed()) return;
    if (window.contentView.children.includes(view)) window.contentView.removeChildView(view);
  }

  private evictIfNeeded(): void {
    if (this.tabs.size < MAX_HEADLESS_TABS) return;
    const oldest = [...this.tabs.values()]
      .filter(
        (tab) =>
          !tab.locked &&
          tab.id !== this.shown?.tabId &&
          !this.userTabs.has(tab.id) &&
          !this.tabClaims.holder(tab.id)
      )
      .sort((a, b) => a.createdAt - b.createdAt)[0];
    if (oldest) void this.destroyTab(oldest);
  }

  /** 回合结束：未锁、用户没在看的 tab 关掉（页面不留后台） */
  async closeForSession(sessionId: string, opts: { force?: boolean } = {}): Promise<void> {
    const tab = this.tabFor(sessionId);
    if (!tab) return;
    if (
      !opts.force &&
      (tab.locked ||
        this.shown?.sessionId === sessionId ||
        this.pendingReveal.has(sessionId) ||
        (tab && this.userTabs.has(tab.id)))
    ) {
      return;
    }
    await this.destroyTab(tab);
  }

  private async destroyTab(tab: Tab, opts?: { keepPersist?: boolean }): Promise<void> {
    this.tabs.delete(tab.id);
    this.tabClaims.closeTab(tab.id);
    if (this.currentBySession.get(tab.ownerSessionId) === tab.id) {
      this.currentBySession.delete(tab.ownerSessionId);
    }
    if (this.agentBySession.get(tab.ownerSessionId) === tab.id) {
      this.agentBySession.delete(tab.ownerSessionId);
    }
    if (!this.disposing && !opts?.keepPersist && !this.userTabs.has(tab.id)) {
      this.forgetTab(tab.id);
    }
    await this.flush();
    this.teardownDevTools(tab);
    this.detach(tab.view);
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
    this.emitState(tab.ownerSessionId, tab.id);
  }

  async flush(): Promise<void> {
    if (!this.guestSession) return;
    await this.guestSession.cookies.flushStore().catch(() => {});
    await this.guestSession.flushStorageData();
  }

  async clearData(kind: BrowserClearKind): Promise<void> {
    const guest = this.getSession();
    if (!isBrowserPartition(partitionName(app.isPackaged))) throw new Error('Refusing to clear');
    if (kind === 'cookies' || kind === 'all') {
      await guest.clearStorageData({ storages: ['cookies'] });
    }
    if (kind === 'cache' || kind === 'all') await guest.clearCache();
    if (kind === 'all') {
      await guest.clearStorageData({
        storages: ['localstorage', 'indexdb', 'serviceworkers', 'cachestorage', 'filesystem'],
      });
    }
  }

  private persistPath(): string {
    return join(app.getPath('userData'), 'browser-tabs.json');
  }

  private loadPersisted(): void {
    if (this.persistedLoaded) return;
    this.persistedLoaded = true;
    try {
      if (!existsSync(this.persistPath())) return;
      this.persisted = parsePersistedBrowserTabs(
        JSON.parse(readFileSync(this.persistPath(), 'utf8')) as unknown
      );
    } catch {
      this.persisted = {};
    }
  }

  private writePersisted(): void {
    try {
      writeFileSync(this.persistPath(), serializePersistedBrowserTabs(this.persisted));
    } catch {}
  }

  private rememberTab(sessionId: string, tab: PersistedBrowserTab): void {
    this.loadPersisted();
    this.persisted[sessionId] = tab;
    this.writePersisted();
  }

  private forgetTab(sessionId: string): void {
    this.loadPersisted();
    if (!(sessionId in this.persisted)) return;
    delete this.persisted[sessionId];
    this.writePersisted();
  }

  private touch(tabId: string): void {
    this.lastSeen.set(tabId, Date.now());
    if (this.idleTimer) return;
    this.idleTimer = setInterval(() => void this.hibernateIdleTabs(), IDLE_TICK_MS);
  }

  private async hibernateIdleTabs(): Promise<void> {
    const now = Date.now();
    for (const tab of [...this.tabs.values()]) {
      if (tab.locked || tab.id === this.shown?.tabId || this.tabClaims.holder(tab.id)) continue;
      const seen = this.lastSeen.get(tab.id) ?? tab.createdAt;
      if (now - seen < IDLE_MS) continue;
      const state = this.stateOf(tab);
      if (state.url.startsWith('http')) {
        this.rememberTab(tab.id, {
          url: state.url,
          title: state.title,
          conversationId: tab.ownerSessionId,
          at: seen,
        });
      }
      if (state.url.startsWith('file:')) continue;
      await this.destroyTab(tab, { keepPersist: true });
    }
    if (this.tabs.size === 0 && this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = undefined;
    }
  }

  private async restoreTab(tabId: string, sessionId?: string): Promise<void> {
    this.loadPersisted();
    if (this.tabs.has(tabId)) return;
    const saved = this.persisted[tabId];
    // 没有持久化 URL = 从没加载过页面。此时建 tab 只会留下一个永久空白页，
    // 并把 agent 的当前 tab 指过去；面板首帧会在真正导航后自己再上报。
    if (!saved?.url) return;
    try {
      assertAllowedUrl(saved.url);
    } catch {
      return;
    }
    const owner = saved.conversationId ?? sessionId ?? tabId;
    const tab = this.createTab(owner, tabId);
    this.userTabs.add(tab.id);
    await tab.view.webContents.loadURL(saved.url).catch(() => {});
  }

  async restorePersistedTabs(): Promise<void> {
    this.loadPersisted();
  }

  listSearchableTabs(): import('@shared/searchAnything').BrowserSearchTab[] {
    this.loadPersisted();
    const live: import('@shared/searchAnything').BrowserSearchTab[] = [];
    for (const tab of this.tabs.values()) {
      if (!this.userTabs.has(tab.id)) continue;
      const state = this.stateOf(tab);
      if (!state.url.startsWith('http')) continue;
      live.push({
        tabId: tab.id,
        conversationId: tab.ownerSessionId,
        title: state.title,
        url: state.url,
        at: this.lastSeen.get(tab.id) ?? tab.createdAt,
        live: true,
      });
    }
    const persisted = Object.entries(this.persisted).flatMap(([tabId, saved]) => {
      if (!saved.url) return [];
      return [
        {
          tabId,
          conversationId: saved.conversationId ?? tabId,
          title: saved.title,
          url: saved.url,
          at: saved.at,
        },
      ];
    });
    return mergeBrowserSearchTabs(live, persisted);
  }

  /** 成员本轮结束 / 被停止：放掉它占着的标签 */
  releaseActor(actorSessionId: string): void {
    this.tabClaims.release(actorSessionId);
  }

  forgetActor(actorSessionId: string): void {
    this.tabClaims.forget(actorSessionId);
  }

  /** 进托盘：关掉所有 guest renderer，HTTP 用户 tab 的 URL 留在 persist 里。 */
  async hibernateAll(): Promise<void> {
    this.shown = null;
    this.shownDevtools = null;
    this.overlayActive = false;
    this.pendingReveal.clear();
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = undefined;
    }
    for (const tab of [...this.tabs.values()]) {
      const state = this.stateOf(tab);
      if (state.url.startsWith('http')) {
        this.rememberTab(tab.id, {
          url: state.url,
          title: state.title,
          conversationId: tab.ownerSessionId,
          at: this.lastSeen.get(tab.id) ?? tab.createdAt,
        });
      }
      await this.destroyTab(tab, { keepPersist: true });
    }
  }

  /** 退出前：flush 后关掉全部 tab。 */
  async dispose(): Promise<void> {
    this.disposing = true;
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = undefined;
    }
    for (const tab of [...this.tabs.values()]) await this.destroyTab(tab);
  }
}

const staleRef = (ref: string) =>
  new Error(`Ref ${ref} is stale or unknown. Call browser_snapshot again and use a fresh ref.`);

export function interpretPageAction(ref: string, outcome: unknown): Error | null {
  if (outcome === 'ok' || outcome === undefined) return null;
  if (outcome === 'covered') {
    return new Error(
      `Element ${ref} is covered or not hittable. Call browser_snapshot again and use a fresh ref.`
    );
  }
  if (outcome === 'stale') return staleRef(ref);
  if (outcome === 'not-editable') return new Error(`Element ${ref} is not editable.`);
  if (typeof outcome === 'string') return new Error(`browser action failed: ${outcome}`);
  return staleRef(ref);
}

export const browserHost = new BrowserHost();
