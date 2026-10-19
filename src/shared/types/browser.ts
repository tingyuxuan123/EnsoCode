/** 内嵌浏览器当前 tab 状态(main → renderer 推送) */
export interface BrowserTabHolder {
  conversationId: string;
  name: string;
}

/** 仅作用单个 tab 的设备预览；enabled=false 表示恢复桌面。 */
export interface BrowserDevice {
  enabled: boolean;
  profileId?: string;
  width?: number;
  height?: number;
  deviceScaleFactor?: number;
  mobile?: boolean;
  touch?: boolean;
  orientation?: 'portrait' | 'landscape';
  /** 面板内预览缩放，不改变网页逻辑 viewport */
  scale?: number;
}

/** 控制权由 Main 持有：manual 时拒绝 Agent 写操作，只有用户 UI 能恢复。 */
export type BrowserControl = 'agent' | 'manual';

export interface BrowserHistoryEntry {
  id: string;
  conversationId: string;
  tabId: string;
  url: string;
  title: string;
  visitedAt: number;
}

export interface BrowserDownloadEntry {
  id: string;
  conversationId: string;
  tabId: string;
  url: string;
  filename: string;
  receivedBytes: number;
  totalBytes: number;
  state: 'progressing' | 'paused' | 'completed' | 'cancelled' | 'interrupted';
  startedAt: number;
  updatedAt: number;
  error?: string;
}

export interface BrowserRecordsQuery {
  query?: string;
  offset?: number;
  limit?: number;
}

export type BrowserHistoryRequest = BrowserRecordsQuery & {
  action?: 'list' | 'remove' | 'clear';
  id?: string;
};

export type BrowserDownloadRequest = BrowserRecordsQuery & {
  action?: 'list' | 'pause' | 'resume' | 'cancel' | 'remove' | 'reveal';
  id?: string;
};

export type BrowserResult<T> = { ok: true; result: T } | { ok: false; error: string };

export interface BrowserTabState {
  /** 无 tab 时为 null */
  tabId: string | null;
  url: string;
  title: string;
  /** 当前页 favicon；没有或不可用为 null */
  favicon: string | null;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** Agent 操作时显示接管入口。 */
  locked: boolean;
  control?: BrowserControl;
  device?: BrowserDevice;
  /** 面板内嵌原生 Chrome DevTools */
  devtoolsOpen: boolean;
  /** 用户圈选 Design Mode */
  designMode: boolean;
  /** 共享浏览器里正在操作该 tab 的成员会话 */
  holder: BrowserTabHolder | null;
}

export type BrowserClearKind = 'cookies' | 'cache' | 'all';

export type BrowserDesignModeEvent =
  | {
      type: 'picked';
      conversationId: string;
      tabId: string;
      payload: {
        label: string;
        path: string;
        text: string;
        tag?: string;
        id?: string;
        className?: string;
        rect?: { x: number; y: number; width: number; height: number };
        component?: string;
      };
      image?: { data: string; mimeType: string };
    }
  | {
      type: 'annotated';
      conversationId: string;
      tabId: string;
      payload: {
        label: string;
        path: string;
        text: string;
        tag?: string;
        id?: string;
        className?: string;
        rect?: { x: number; y: number; width: number; height: number };
        component?: string;
      };
      image?: { data: string; mimeType: string };
    }
  | { type: 'cancelled'; conversationId: string; tabId: string };
