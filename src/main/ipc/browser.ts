import { parseBrowserViewport } from '@shared/browser/viewport';
import { IPC_CHANNELS } from '@shared/types';
import { ipcMain, type WebContents } from 'electron';
import { browserHost } from '../services/browserHost';
import { sendToAllWindows } from '../windows/createAppWindow';
import { isMainWebContents } from '../windows/MainWindow';
import { isSettingsWebContents } from '../windows/SettingsWindow';

const isId = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object';

const watchedReporters = new WeakSet<WebContents>();

/** 上报方没了 / 整页重载：不把上一代 renderer 的遮挡值永久闩住。 */
function watchOverlayReporter(sender: WebContents): void {
  if (watchedReporters.has(sender)) return;
  watchedReporters.add(sender);
  const reset = () => browserHost.resetOverlayReports();
  sender.on('destroyed', reset);
  sender.on('render-process-gone', reset);
  sender.on('did-start-navigation', (details: unknown) => {
    if (!isRecord(details)) return;
    if (details.isMainFrame === true && details.isSameDocument !== true) reset();
  });
}

/** 遮挡上报只信主窗口 renderer；共用 preload 的设置窗开 Dialog 不得把主窗 guest 沉下去。 */
const fromMainRenderer = (event: { sender: WebContents }): boolean => {
  if (!isMainWebContents(event.sender.id)) return false;
  watchOverlayReporter(event.sender);
  return true;
};

/** 右侧面板内嵌浏览器：矩形上报、地址栏动作、清数据。业务在 browserHost。 */
export function registerBrowserHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.BROWSER_SET_VIEWPORT,
    (event, tabId: unknown, conversationId: unknown, raw: unknown, covered: unknown) => {
      if (!isId(tabId) || !isId(conversationId) || !fromMainRenderer(event)) {
        return browserHost.state('');
      }
      return browserHost.setViewport(
        tabId,
        conversationId,
        raw === null ? null : parseBrowserViewport(raw),
        covered === true
      );
    }
  );
  ipcMain.on(IPC_CHANNELS.BROWSER_SET_OVERLAY_ACTIVE, (event, active: unknown) => {
    if (!fromMainRenderer(event)) return;
    browserHost.setOverlayActive(active === true);
  });
  ipcMain.handle(
    IPC_CHANNELS.BROWSER_NAVIGATE,
    async (event, tabId: unknown, conversationId: unknown, url: unknown) => {
      if (
        !fromMainRenderer(event) ||
        !isId(tabId) ||
        !isId(conversationId) ||
        typeof url !== 'string'
      ) {
        return { ok: false, error: 'Invalid request' };
      }
      try {
        await browserHost.userNavigate(tabId, conversationId, url);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  );
  ipcMain.handle(IPC_CHANNELS.BROWSER_GO_BACK, (event, tabId: unknown) => {
    if (fromMainRenderer(event) && isId(tabId)) browserHost.goBack(tabId);
  });
  ipcMain.handle(IPC_CHANNELS.BROWSER_GO_FORWARD, (event, tabId: unknown) => {
    if (fromMainRenderer(event) && isId(tabId)) browserHost.goForward(tabId);
  });
  ipcMain.handle(IPC_CHANNELS.BROWSER_RELOAD, (event, tabId: unknown) => {
    if (fromMainRenderer(event) && isId(tabId)) browserHost.reload(tabId);
  });
  ipcMain.handle(IPC_CHANNELS.BROWSER_STOP, async (event, tabId: unknown) => {
    if (!fromMainRenderer(event) || !isId(tabId)) return { ok: false, error: 'Invalid request' };
    try {
      browserHost.stop(tabId);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle(
    IPC_CHANNELS.BROWSER_SET_DEVICE,
    async (event, tabId: unknown, conversationId: unknown, device: unknown) => {
      if (!fromMainRenderer(event) || !isId(tabId) || !isId(conversationId)) {
        return { ok: false, error: 'Invalid request' };
      }
      try {
        return { ok: true, result: await browserHost.setDevice(tabId, conversationId, device) };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  );
  ipcMain.handle(
    IPC_CHANNELS.BROWSER_HISTORY,
    async (event, conversationId: unknown, request: unknown) => {
      if (
        !fromMainRenderer(event) ||
        !isId(conversationId) ||
        !isRecord(request) ||
        Array.isArray(request)
      ) {
        return { ok: false, error: 'Invalid request' };
      }
      try {
        return { ok: true, result: await browserHost.history(conversationId, request) };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  );
  ipcMain.handle(
    IPC_CHANNELS.BROWSER_DOWNLOADS,
    async (event, conversationId: unknown, request: unknown) => {
      if (
        !fromMainRenderer(event) ||
        !isId(conversationId) ||
        !isRecord(request) ||
        Array.isArray(request)
      ) {
        return { ok: false, error: 'Invalid request' };
      }
      try {
        return { ok: true, result: await browserHost.downloads(conversationId, request) };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  );
  browserHost.onDownloadsChanged((conversationId) => {
    sendToAllWindows(IPC_CHANNELS.BROWSER_DOWNLOADS_CHANGED, { conversationId });
  });
  ipcMain.handle(IPC_CHANNELS.BROWSER_CLOSE_TAB, async (event, tabId: unknown) => {
    if (fromMainRenderer(event) && isId(tabId)) await browserHost.closeTab(tabId);
  });
  ipcMain.handle(IPC_CHANNELS.BROWSER_CLOSE_SESSION, async (event, conversationId: unknown) => {
    if (fromMainRenderer(event) && isId(conversationId)) {
      await browserHost.closeSession(conversationId);
    }
  });
  ipcMain.handle(IPC_CHANNELS.BROWSER_CLEAR_DATA, async (event, kind: unknown) => {
    if (!isMainWebContents(event.sender.id) && !isSettingsWebContents(event.sender.id)) return;
    if (kind !== 'cookies' && kind !== 'cache' && kind !== 'all') return;
    await browserHost.clearData(kind);
  });
  ipcMain.handle(IPC_CHANNELS.BROWSER_RESTORE_TABS, (event) => {
    if (fromMainRenderer(event)) return browserHost.restorePersistedTabs();
  });
  ipcMain.handle(IPC_CHANNELS.BROWSER_LIST_SEARCHABLE_TABS, (event) =>
    fromMainRenderer(event) ? browserHost.listSearchableTabs() : []
  );
  ipcMain.handle(
    IPC_CHANNELS.BROWSER_SET_LOCKED,
    async (event, conversationId: unknown, locked: unknown) => {
      if (!fromMainRenderer(event) || !isId(conversationId) || typeof locked !== 'boolean') return;
      await browserHost.setLocked(conversationId, locked);
    }
  );
  ipcMain.handle(IPC_CHANNELS.BROWSER_SET_DEVTOOLS, (event, tabId: unknown, open: unknown) => {
    if (!fromMainRenderer(event) || !isId(tabId) || typeof open !== 'boolean') {
      return browserHost.state('');
    }
    return browserHost.setDevTools(tabId, open);
  });
  ipcMain.handle(
    IPC_CHANNELS.BROWSER_SET_DEVTOOLS_VIEWPORT,
    (event, tabId: unknown, conversationId: unknown, raw: unknown, covered: unknown) => {
      if (!isId(tabId) || !isId(conversationId) || !fromMainRenderer(event)) {
        return browserHost.state('');
      }
      return browserHost.setDevToolsViewport(
        tabId,
        conversationId,
        raw === null ? null : parseBrowserViewport(raw),
        covered === true
      );
    }
  );
  browserHost.onState((conversationId, tabId, state) => {
    sendToAllWindows(IPC_CHANNELS.BROWSER_STATE, { conversationId, tabId, state });
  });
  browserHost.onReveal((conversationId, tabId) => {
    sendToAllWindows(IPC_CHANNELS.BROWSER_REVEAL, { conversationId, tabId });
  });
  browserHost.onTabClosed((conversationId, tabId) => {
    sendToAllWindows(IPC_CHANNELS.BROWSER_TAB_CLOSED, { conversationId, tabId });
  });
  ipcMain.handle(
    IPC_CHANNELS.BROWSER_SET_DESIGN_MODE,
    async (event, tabId: unknown, enabled: unknown) => {
      if (!fromMainRenderer(event) || !isId(tabId) || typeof enabled !== 'boolean') {
        return browserHost.state('');
      }
      return browserHost.setDesignMode(tabId, enabled);
    }
  );
  browserHost.onDesignMode((event) => {
    sendToAllWindows(IPC_CHANNELS.BROWSER_DESIGN_MODE_EVENT, event);
  });
}
