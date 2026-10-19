import type { BrowserDevice, BrowserTabState } from '@shared/types/browser';
import {
  ArrowLeft,
  ArrowRight,
  Bug,
  Download,
  Ellipsis,
  Globe,
  Hand,
  History,
  Info,
  MonitorSmartphone,
  RotateCw,
  Square,
  SquareArrowOutUpRight,
  SquareDashedMousePointer,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  insertComposerImage,
  insertUiElementMention,
  requestFocusComposer,
} from '@/components/chat/composerMentionBridge';
import { Button } from '@/components/ui/button';
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import { addToast } from '@/components/ui/toast';
import { useI18n } from '@/i18n';
import { syncOverlayGuard } from '@/lib/overlayGuard';
import { resolveSidePanelDockConversationId } from '@/lib/sidePanelDockId';
import { cn } from '@/lib/utils';
import { useSessionsStore } from '@/stores/sessions';
import { useSidePanelStore } from '@/stores/sidePanel';
import {
  BROWSER_STAGE_BACKGROUNDS,
  BrowserDeviceToolbar,
  type BrowserStageBackground,
  DEFAULT_BROWSER_DEVICE,
} from './BrowserDeviceToolbar';
import { BrowserDownloadsPanel } from './BrowserDownloadsPanel';
import { BrowserHistoryPanel } from './BrowserHistoryPanel';
import { BrowserNewTab } from './BrowserNewTab';
import { browserDeviceFrame, resolveBrowserAddress } from './browserUi';
import { isCoveredBy, overlayBoxes } from './overlayCover';

const EMPTY: BrowserTabState = {
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

type Rect = { x: number; y: number; width: number; height: number };
type Size = { width: number; height: number };

const sameRect = (a: Rect | null, b: Rect | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height);

const MIN_PANE = 80;
const DEFAULT_DEVTOOLS_RATIO = 0.42;
const STAGE_PADDING = 24;
const MIN_DEVICE = 50;
const MAX_DEVICE = 8192;

function readBox(el: HTMLElement | null): Rect | null {
  if (!el?.isConnected) return null;
  const box = el.getBoundingClientRect();
  if (box.width < 1 || box.height < 1) return null;
  return {
    x: Math.round(box.left),
    y: Math.round(box.top),
    width: Math.round(box.width),
    height: Math.round(box.height),
  };
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Agent 持有 tab 的累计时长；松开锁定即清零 */
function useElapsed(active: boolean): string {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) {
      setStartedAt(null);
      return;
    }
    const start = Date.now();
    setStartedAt(start);
    setNow(start);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return formatElapsed(startedAt === null ? 0 : now - startedAt);
}

/**
 * 真实网页由 Main 的 WebContentsView 画在主窗口上；这里只是一块占位 div，
 * 负责把自己的屏幕矩形与可见性报给 Main，并渲染地址栏。
 * 侧栏宽度动画 / 拖拽期间矩形连续变化，用 rAF 轮询比事件拼接更稳。
 * 设备预览时占位 div 缩成居中的设备框，Main 以同一矩形算 fit 缩放。
 */
/** BrowserView 宿主：Code 用 dockview 面板，Bot 右侧面板用固定 tab */
export interface BrowserSurface {
  readonly id: string;
  readonly isActive: boolean;
  readonly isVisible: boolean;
  setTitle(title: string): void;
  getParameters(): object | undefined;
  updateParameters(params: object): void;
}

export function BrowserView({
  conversationId,
  panelApi,
  active,
}: {
  conversationId: string;
  panelApi: BrowserSurface;
  /** 宿主自行判定可见时传入（Bot 面板）；缺省按 Code 侧栏与当前会话判定 */
  active?: boolean;
}) {
  const { t } = useI18n();
  const dockConversationId = useSessionsStore((s) =>
    resolveSidePanelDockConversationId(s.conversations, conversationId)
  );
  const sidebarOpen = useSidePanelStore(
    (s) => s.uiByConversation[dockConversationId]?.open ?? false
  );
  const isActiveConversation = useSessionsStore((s) => s.activeId === dockConversationId);
  const hostVisible = active ?? (sidebarOpen && isActiveConversation);
  const [state, setState] = useState<BrowserTabState>(EMPTY);
  const [address, setAddress] = useState('');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<'history' | 'downloads' | null>(null);
  const [controlBusy, setControlBusy] = useState(false);
  const [stage, setStage] = useState<Size | null>(null);
  const [stageBackground, setStageBackground] = useState<BrowserStageBackground>('default');
  const [liveSize, setLiveSize] = useState<Size | null>(null);
  const manualControl = state.control === 'manual';
  const agentLocked = state.locked && !manualControl;
  const elapsed = useElapsed(agentLocked);
  const [devtoolsRatio, setDevtoolsRatio] = useState(DEFAULT_DEVTOOLS_RATIO);
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const dtRef = useRef<HTMLDivElement>(null);
  const splitRef = useRef<HTMLDivElement>(null);
  const lastSent = useRef<Rect | null | undefined>(undefined);
  const lastCovered = useRef(false);
  const lastDt = useRef<Rect | null | undefined>(undefined);
  const lastDtCovered = useRef(false);
  const lastStage = useRef<Size | null>(null);
  const lockedRef = useRef(false);
  lockedRef.current = agentLocked;
  const devtoolsOpenRef = useRef(false);
  devtoolsOpenRef.current = state.devtoolsOpen;
  const hasPage = /^(https?:|file:)/.test(state.url);
  const hasPageRef = useRef(false);
  hasPageRef.current = hasPage;
  // host 透明、真正露出网页时才挖壁纸；空白占位/加载中保留壁纸垫底
  const showsPage = hasPage && !state.loading;
  const showsPageRef = useRef(false);
  showsPageRef.current = showsPage;
  const lastHole = useRef<Rect | null>(null);
  const tabId = panelApi.id;
  const device = state.device?.enabled ? state.device : null;
  const shownDevice: BrowserDevice | null =
    device && liveSize ? { ...device, width: liveSize.width, height: liveSize.height } : device;
  const frame = shownDevice && stage ? browserDeviceFrame(shownDevice, stage, STAGE_PADDING) : null;

  useEffect(() => {
    return window.electronAPI.browser.onState((event) => {
      if (event.tabId === tabId) setState(event.state);
    });
  }, [tabId]);

  useEffect(() => {
    return window.electronAPI.browser.onDesignMode((event) => {
      if (event.tabId !== tabId) return;
      if (event.type === 'cancelled') return;
      let inserted = false;
      if (event.type === 'annotated') {
        inserted = event.image ? insertComposerImage(event.image) : false;
      } else {
        const id =
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `ui-${Date.now()}`;
        inserted = insertUiElementMention(
          {
            kind: 'ui-element',
            id,
            label: event.payload.label || event.payload.tag || 'element',
            path: event.payload.path || event.payload.tag || 'element',
            text: event.payload.text || event.payload.label || event.payload.tag || 'element',
            imageId: `img-${id}`,
          },
          event.image
        );
      }
      if (!inserted) addToast({ type: 'warning', title: t('No Composer for this selection') });
      else requestFocusComposer();
    });
  }, [tabId, t]);

  useEffect(() => {
    if (!state.designMode) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      void window.electronAPI.browser.setDesignMode(tabId, false).then(setState);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [state.designMode, tabId]);

  useEffect(() => {
    if (!editing) setAddress(state.url);
  }, [state.url, editing]);

  useEffect(() => {
    const title = state.title.trim() || t('Browser');
    panelApi.setTitle(title);
    panelApi.updateParameters({ ...panelApi.getParameters(), favicon: state.favicon });
  }, [panelApi, state.title, state.favicon, t]);

  useEffect(() => {
    let raf = 0;
    let disposed = false;
    const root = document.getElementById('root');
    // 挂载即全量重推：矩形 / covered 靠首帧必发，浮层状态靠这一次显式同步
    syncOverlayGuard();
    const tick = () => {
      if (disposed) return;
      const stageBox = readBox(stageRef.current);
      const nextStage = stageBox ? { width: stageBox.width, height: stageBox.height } : null;
      const prevStage = lastStage.current;
      if (prevStage?.width !== nextStage?.width || prevStage?.height !== nextStage?.height) {
        lastStage.current = nextStage;
        setStage(nextStage);
      }
      const visible =
        hostVisible &&
        panelApi.isActive &&
        panelApi.isVisible &&
        document.visibilityState === 'visible';
      const rect = visible ? readBox(hostRef.current) : null;
      const covered =
        rect !== null &&
        (!hasPageRef.current ||
          lockedRef.current ||
          isCoveredBy(rect, overlayBoxes(document, root)));
      if (
        lastSent.current === undefined ||
        !sameRect(lastSent.current, rect) ||
        covered !== lastCovered.current
      ) {
        lastSent.current = rect;
        lastCovered.current = covered;
        void window.electronAPI.browser
          .setViewport(tabId, conversationId, rect, covered)
          .then(setState);
      }
      const hole = showsPageRef.current ? rect : null;
      if (!sameRect(lastHole.current, hole)) {
        lastHole.current = hole;
        useSidePanelStore.getState().setBrowserHole(`${tabId}:guest`, hole);
      }
      const dtRect = visible && devtoolsOpenRef.current ? readBox(dtRef.current) : null;
      const dtCovered = dtRect !== null && isCoveredBy(dtRect, overlayBoxes(document, root));
      if (
        lastDt.current === undefined ||
        !sameRect(lastDt.current, dtRect) ||
        dtCovered !== lastDtCovered.current
      ) {
        useSidePanelStore.getState().setBrowserHole(`${tabId}:devtools`, dtRect);
        lastDt.current = dtRect;
        lastDtCovered.current = dtCovered;
        void window.electronAPI.browser
          .setDevToolsViewport(tabId, conversationId, dtRect, dtCovered)
          .then(setState);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      const { setBrowserHole } = useSidePanelStore.getState();
      setBrowserHole(`${tabId}:guest`, null);
      setBrowserHole(`${tabId}:devtools`, null);
      lastHole.current = null;
      if (lastSent.current !== null) {
        lastSent.current = null;
        void window.electronAPI.browser.setViewport(tabId, conversationId, null);
      }
      if (lastDt.current !== null) {
        lastDt.current = null;
        void window.electronAPI.browser.setDevToolsViewport(tabId, conversationId, null);
      }
    };
  }, [conversationId, tabId, panelApi, hostVisible]);

  const navigate = async (raw: string): Promise<boolean> => {
    const target = resolveBrowserAddress(raw);
    if (!target.ok) {
      setError(t(target.error));
      return false;
    }
    setEditing(false);
    setAddress(target.result);
    try {
      const result = await window.electronAPI.browser.navigate(
        tabId,
        conversationId,
        target.result
      );
      setError(result.ok ? null : (result.error ?? t('Navigation failed')));
      return result.ok;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('Navigation failed'));
      return false;
    }
  };

  const changeControl = async (control: 'manual' | 'agent') => {
    setControlBusy(true);
    setError(null);
    try {
      const result = await window.electronAPI.browser.setControl(tabId, conversationId, control);
      if (result.ok) setState(result.result);
      else setError(result.error);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('Could not change browser control.'));
    } finally {
      setControlBusy(false);
    }
  };

  const browserAction = async (
    action: () => Promise<{ ok: boolean; error?: string }> | Promise<void>
  ) => {
    try {
      const result = await action();
      setError(!result || result.ok ? null : (result.error ?? t('Browser action failed.')));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('Browser action failed.'));
    }
  };

  const applyDevice = async (next: BrowserDevice) => {
    const result = await window.electronAPI.browser.setDevice(tabId, conversationId, next);
    if (result.ok) setState(result.result);
    return result;
  };

  const toggleDevice = () =>
    void browserAction(() => applyDevice(device ? { enabled: false } : DEFAULT_BROWSER_DEVICE));

  const onSplitPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const host = stageRef.current;
    const dt = dtRef.current;
    if (!host || !dt) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const startY = event.clientY;
    const startHost = host.getBoundingClientRect().height;
    const startDt = dt.getBoundingClientRect().height;
    const total = startHost + startDt;
    const onMove = (move: globalThis.PointerEvent) => {
      const nextDt = Math.min(
        total - MIN_PANE,
        Math.max(MIN_PANE, startDt - (move.clientY - startY))
      );
      setDevtoolsRatio(nextDt / total);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  /** 拖拽设备框边缘：框保持居中，边缘跟手需要按 2 倍位移换算逻辑尺寸 */
  const onDeviceResize =
    (axis: 'x' | 'y' | 'xy') => (event: React.PointerEvent<HTMLDivElement>) => {
      if (!device || !frame || agentLocked) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      const startX = event.clientX;
      const startY = event.clientY;
      const startWidth = device.width ?? 393;
      const startHeight = device.height ?? 852;
      const scale = frame.scale;
      const clamp = (value: number) =>
        Math.min(MAX_DEVICE, Math.max(MIN_DEVICE, Math.round(value)));
      let latest: Size = { width: startWidth, height: startHeight };
      let sent: Size = latest;
      let inFlight = false;
      let released = false;
      const base = device;
      const send = () => {
        if (inFlight || (sent.width === latest.width && sent.height === latest.height)) {
          if (released && !inFlight) setLiveSize(null);
          return;
        }
        inFlight = true;
        sent = latest;
        void applyDevice({
          ...base,
          profileId: 'responsive',
          width: sent.width,
          height: sent.height,
          orientation: sent.width > sent.height ? 'landscape' : 'portrait',
        })
          .catch(() => undefined)
          .finally(() => {
            inFlight = false;
            send();
          });
      };
      const onMove = (move: globalThis.PointerEvent) => {
        latest = {
          width:
            axis === 'y' ? startWidth : clamp(startWidth + ((move.clientX - startX) * 2) / scale),
          height:
            axis === 'x' ? startHeight : clamp(startHeight + ((move.clientY - startY) * 2) / scale),
        };
        setLiveSize(latest);
        send();
      };
      const onUp = () => {
        released = true;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        send();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    };

  const iconButton = 'size-7 shrink-0 text-muted-foreground hover:text-foreground';
  const stageBackgroundClass =
    BROWSER_STAGE_BACKGROUNDS.find((entry) => entry.value === stageBackground)?.className ??
    'bg-muted/70';
  const canOpenExternal = /^https?:/.test(state.url);
  const handle =
    'absolute z-10 flex items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-xs transition-colors hover:text-foreground';

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-0.5 border-b border-border/70 px-2">
        <Button
          variant="ghost"
          size="icon-xs"
          className={iconButton}
          disabled={agentLocked || !state.canGoBack}
          onClick={() => void browserAction(() => window.electronAPI.browser.goBack(tabId))}
          aria-label={t('Back')}
          title={t('Back')}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          className={iconButton}
          disabled={agentLocked || !state.canGoForward}
          onClick={() => void browserAction(() => window.electronAPI.browser.goForward(tabId))}
          aria-label={t('Forward')}
          title={t('Forward')}
        >
          <ArrowRight className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          className={iconButton}
          disabled={agentLocked || !state.tabId}
          onClick={() =>
            void browserAction(() =>
              state.loading
                ? window.electronAPI.browser.stop(tabId)
                : window.electronAPI.browser.reload(tabId)
            )
          }
          aria-label={t(state.loading ? 'Stop loading' : 'Reload')}
          title={t(state.loading ? 'Stop loading' : 'Reload')}
        >
          {state.loading ? <Square className="size-3.5" /> : <RotateCw className="size-4" />}
        </Button>
        <form
          className="relative mx-1 min-w-0 flex-1"
          onSubmit={(event) => {
            event.preventDefault();
            void navigate(address);
          }}
        >
          {hasPage ? (
            <Info className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          ) : (
            <Globe className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          )}
          <input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            onFocus={(event) => {
              setEditing(true);
              event.target.select();
            }}
            onBlur={() => setEditing(false)}
            placeholder={t('Search or enter a URL')}
            aria-label={t('Search or enter a URL')}
            spellCheck={false}
            disabled={agentLocked}
            className="h-8 w-full min-w-0 rounded-lg border border-border/70 bg-muted/50 pl-8 pr-3 text-xs text-foreground outline-none transition-[background-color,border-color,box-shadow] placeholder:text-muted-foreground/72 hover:bg-muted/70 focus:border-ring focus:bg-background focus:ring-2 focus:ring-ring/25 disabled:opacity-64"
          />
        </form>
        {manualControl && (
          <Button
            variant="outline"
            size="xs"
            className="shrink-0 rounded-full"
            disabled={controlBusy}
            title={t('Manual control')}
            onClick={() => void changeControl('agent')}
          >
            {t('Allow agent to continue')}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          className={iconButton}
          disabled={!canOpenExternal}
          onClick={() => window.open(state.url, '_blank')}
          aria-label={t('Open in Browser')}
          title={t('Open in Browser')}
        >
          <SquareArrowOutUpRight className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          className={cn(iconButton, state.designMode && 'bg-muted text-foreground')}
          disabled={!state.tabId || agentLocked || state.devtoolsOpen}
          onClick={() =>
            void window.electronAPI.browser.setDesignMode(tabId, !state.designMode).then(setState)
          }
          aria-label={t('Toggle Design Mode')}
          title={t('Toggle Design Mode')}
          aria-pressed={state.designMode}
        >
          <SquareDashedMousePointer className="size-4" />
        </Button>
        <Menu>
          <MenuTrigger
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 data-popup-open:bg-accent data-popup-open:text-foreground"
            aria-label={t('More actions')}
            title={t('More actions')}
          >
            <Ellipsis className="size-4" />
          </MenuTrigger>
          <MenuPopup align="end" className="min-w-48">
            <MenuItem
              disabled={agentLocked || controlBusy || state.devtoolsOpen}
              onClick={toggleDevice}
            >
              <MonitorSmartphone />
              <span className="flex-1">{t('Device preview')}</span>
              {device && <span className="size-1.5 rounded-full bg-primary" />}
            </MenuItem>
            <MenuItem
              disabled={!state.tabId}
              onClick={() =>
                void window.electronAPI.browser
                  .setDevTools(tabId, !state.devtoolsOpen)
                  .then(setState)
              }
            >
              <Bug />
              <span className="flex-1">{t('Toggle Developer Tools')}</span>
              {state.devtoolsOpen && <span className="size-1.5 rounded-full bg-primary" />}
            </MenuItem>
            <MenuSeparator />
            <MenuItem onClick={() => setPanel('history')}>
              <History />
              {t('Browsing history')}
            </MenuItem>
            <MenuItem onClick={() => setPanel('downloads')}>
              <Download />
              {t('Browser downloads')}
            </MenuItem>
            {!manualControl && (
              <>
                <MenuSeparator />
                <MenuItem disabled={controlBusy} onClick={() => void changeControl('manual')}>
                  <Hand />
                  {t('Take control')}
                </MenuItem>
              </>
            )}
          </MenuPopup>
        </Menu>
      </div>
      {device && (
        <BrowserDeviceToolbar
          device={device}
          scale={frame?.scale ?? null}
          liveSize={liveSize}
          disabled={agentLocked || controlBusy}
          background={stageBackground}
          onBackgroundChange={setStageBackground}
          onApply={applyDevice}
        />
      )}
      {error && (
        <div
          role="alert"
          className="break-words border-b bg-destructive/10 px-3 py-1 text-xs text-destructive"
        >
          {error}
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col" data-slot="browser-native-stack">
        <div
          ref={stageRef}
          className={cn(
            'relative min-h-0 overflow-hidden',
            state.devtoolsOpen ? 'shrink-0' : 'flex-1',
            device && cn('flex items-center justify-center', stageBackgroundClass)
          )}
          style={state.devtoolsOpen ? { flex: `${1 - devtoolsRatio} 1 0` } : undefined}
        >
          <div
            ref={hostRef}
            className={cn(
              'relative min-h-0',
              frame ? 'shrink-0 shadow-sm ring-1 ring-border/70' : 'absolute inset-0',
              showsPage ? 'bg-transparent' : 'bg-background'
            )}
            style={frame ? { width: frame.width, height: frame.height } : undefined}
          >
            {!hasPage && <BrowserNewTab />}
            {frame && !agentLocked && (
              <>
                <div
                  className={cn(
                    handle,
                    '-right-4 top-1/2 h-8 w-2.5 -translate-y-1/2 cursor-ew-resize'
                  )}
                  onPointerDown={onDeviceResize('x')}
                  aria-hidden
                >
                  <span className="h-4 w-px bg-current opacity-60" />
                </div>
                <div
                  className={cn(
                    handle,
                    '-bottom-4 left-1/2 h-2.5 w-8 -translate-x-1/2 cursor-ns-resize'
                  )}
                  onPointerDown={onDeviceResize('y')}
                  aria-hidden
                >
                  <span className="h-px w-4 bg-current opacity-60" />
                </div>
                <div
                  className={cn(
                    handle,
                    '-bottom-4 -right-4 size-3.5 cursor-nwse-resize rounded-[4px]'
                  )}
                  onPointerDown={onDeviceResize('xy')}
                  aria-hidden
                />
              </>
            )}
          </div>
          {agentLocked && (
            <div className="absolute inset-0 cursor-default">
              <div className="browser-agent-glow pointer-events-none absolute inset-0" />
              <div className="absolute bottom-5 left-1/2 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-3 rounded-full border border-border/80 bg-popover py-1.5 pl-5 pr-1.5 text-popover-foreground shadow-lg">
                <div className="min-w-0 leading-tight">
                  <div className="truncate text-xs font-medium" title={state.holder?.name}>
                    {state.holder
                      ? t('{{name}} is using this tab', { name: state.holder.name })
                      : t('Agent is browsing')}
                  </div>
                  <div className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                    {t('In control {{time}}', { time: elapsed })}
                  </div>
                </div>
                <span className="h-7 w-px shrink-0 bg-border" />
                <Button
                  variant="secondary"
                  size="sm"
                  className="shrink-0 rounded-full"
                  disabled={controlBusy}
                  onClick={() => void changeControl('manual')}
                >
                  <Hand className="size-4" />
                  {t('Let me take over')}
                </Button>
              </div>
            </div>
          )}
        </div>
        {state.devtoolsOpen && (
          <>
            <div
              ref={splitRef}
              className="h-1.5 shrink-0 cursor-row-resize bg-border hover:bg-ring"
              onPointerDown={onSplitPointer}
            />
            <div
              ref={dtRef}
              className="min-h-0 bg-transparent"
              style={{ flex: `${devtoolsRatio} 1 0` }}
            />
          </>
        )}
      </div>
      <BrowserHistoryPanel
        open={panel === 'history'}
        onOpenChange={(open) => setPanel(open ? 'history' : null)}
        conversationId={conversationId}
        onNavigate={navigate}
        navigationDisabled={agentLocked}
      />
      <BrowserDownloadsPanel
        open={panel === 'downloads'}
        onOpenChange={(open) => setPanel(open ? 'downloads' : null)}
        conversationId={conversationId}
      />
    </div>
  );
}
