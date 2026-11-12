import type { BrowserDevice, BrowserTabState } from '@shared/types/browser';
import {
  ArrowLeft,
  ArrowRight,
  Bug,
  Download,
  Ellipsis,
  Globe,
  History,
  Info,
  ListPlus,
  MonitorSmartphone,
  RotateCw,
  Square,
  SquareArrowOutUpRight,
  SquareDashedMousePointer,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  insertComposerImage,
  insertUiElementMention,
  insertUiElementMentions,
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
import {
  addAnnotation,
  annotationMentionInsert,
  annotationScopeKey,
  clearAnnotations,
  pruneAnnotations,
  removeAnnotation,
  updateAnnotationNote,
  useBrowserAnnotations,
} from './browserAnnotations';
import { browserDeviceFrame, deviceStageClip, resolveBrowserAddress } from './browserUi';
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
  const [stage, setStage] = useState<Size | null>(null);
  const [stageBackground, setStageBackground] = useState<BrowserStageBackground>('default');
  const [liveSize, setLiveSize] = useState<Size | null>(null);
  // 多点标注：开启后每次选取先入清单，最后一次性合并进 Composer
  const [multi, setMulti] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const lastSent = useRef<Rect | null | undefined>(undefined);
  const lastCovered = useRef(false);
  const lastDt = useRef<Rect | null | undefined>(undefined);
  const lastDtCovered = useRef(false);
  const lastStage = useRef<Size | null>(null);
  // 停靠的 DevTools 铺满舞台，网页由 Main 叠在前端上报的区域；独立窗口时舞台照常给网页
  const devtoolsDocked = state.devtoolsOpen && state.devtoolsDock !== 'undocked';
  const devtoolsDockedRef = useRef(false);
  devtoolsDockedRef.current = devtoolsDocked;
  const hasPage = /^(https?:|file:)/.test(state.url);
  const hasPageRef = useRef(false);
  hasPageRef.current = hasPage;
  // host 透明、真正露出网页时才挖壁纸；空白占位/加载中保留壁纸垫底
  const showsPage = hasPage && !state.loading;
  const showsPageRef = useRef(false);
  showsPageRef.current = showsPage;
  const lastHole = useRef<Rect | null>(null);
  const tabId = panelApi.id;
  const annotationScope = { conversationId, tabId, url: state.url };
  const annotationKey = annotationScopeKey(annotationScope);
  const annotations = useBrowserAnnotations(annotationScope);
  const multiRef = useRef(false);
  const discardLatePick = useRef(false);
  const modeRequest = useRef(Promise.resolve());
  const requestDesignMode = useCallback(
    (enabled: boolean) => {
      modeRequest.current = modeRequest.current
        .then(async () => {
          setState(await window.electronAPI.browser.setDesignMode(tabId, enabled));
        })
        .catch(() => {});
    },
    [tabId]
  );
  const setMultiMode = useCallback(
    (enabled: boolean) => {
      discardLatePick.current = !enabled;
      multiRef.current = enabled;
      setMulti(enabled);
      requestDesignMode(enabled);
    },
    [requestDesignMode]
  );
  const visibleForPick = useRef(false);
  visibleForPick.current = hostVisible && panelApi.isActive && panelApi.isVisible;
  // 圈选事件不带页面地址，队列却要按页面隔离，所以从 ref 里取当前 url
  const urlRef = useRef(state.url);
  urlRef.current = state.url;
  const device = state.device?.enabled ? state.device : null;
  const shownDevice: BrowserDevice | null =
    device && liveSize ? { ...device, width: liveSize.width, height: liveSize.height } : device;
  const frame =
    shownDevice && stage && !devtoolsDocked
      ? browserDeviceFrame(shownDevice, stage, STAGE_PADDING)
      : null;

  useEffect(() => {
    return window.electronAPI.browser.onState((event) => {
      if (event.tabId === tabId) setState(event.state);
    });
  }, [tabId]);

  useEffect(() => {
    return window.electronAPI.browser.onDesignMode((event) => {
      if (event.tabId !== tabId || event.conversationId !== conversationId) return;
      if (event.type === 'cancelled') {
        // 页面里 Esc 退出圈选：清单留着，停止自动重新进入
        if (multiRef.current) setMultiMode(false);
        return;
      }
      if (discardLatePick.current) return;
      if (event.url !== undefined && event.url !== urlRef.current) return;
      if (multiRef.current) {
        if (!visibleForPick.current || !panelApi.isActive || !panelApi.isVisible) {
          setMultiMode(false);
          return;
        }
        const payload = event.payload;
        const region = event.type === 'annotated';
        const fallback = event.type === 'annotated' ? 'annotation' : 'element';
        const entry = addAnnotation({
          conversationId,
          tabId,
          url: urlRef.current,
          kind: region ? 'region' : 'element',
          label: payload.label || payload.tag || fallback,
          path: payload.path || payload.tag || fallback,
          text: payload.text || payload.label || payload.tag || fallback,
          ...(event.image ? { image: event.image } : {}),
          ...(payload.rect ? { rect: payload.rect } : {}),
        });
        if (!entry) {
          addToast({
            type: 'warning',
            title: t('Annotation list is full. Add it to the conversation or remove a selection.'),
          });
          setMultiMode(false);
          return;
        }
        // Main 每次取完都会关掉圈选；多点模式重新打开，用户接着点下一个
        requestDesignMode(true);
        return;
      }
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
  }, [conversationId, panelApi, requestDesignMode, setMultiMode, tabId, t]);

  useEffect(() => {
    pruneAnnotations({ conversationId, tabId, url: state.url });
  }, [conversationId, tabId, state.url]);

  useEffect(() => {
    if (!hostVisible && multiRef.current) setMultiMode(false);
  }, [hostVisible, setMultiMode]);

  useEffect(() => {
    if (!state.designMode) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (multiRef.current) setMultiMode(false);
      else requestDesignMode(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [state.designMode, requestDesignMode, setMultiMode]);

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
    let lastPixelRatio = window.devicePixelRatio;
    const root = document.getElementById('root');
    // 挂载即全量重推：矩形 / covered 靠首帧必发，浮层状态靠这一次显式同步
    syncOverlayGuard();
    const tick = () => {
      if (disposed) return;
      // 页面缩放会改变 DPR；即使 CSS 矩形没动，也让 Main 按新 zoom 重新换算。
      // DPR 只用于失效缓存，不能作为换算率（它还包含显示器缩放）。
      const zoomChanged = lastPixelRatio !== window.devicePixelRatio;
      lastPixelRatio = window.devicePixelRatio;
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
      if (!visible && multiRef.current) setMultiMode(false);
      const rect = visible ? readBox(hostRef.current) : null;
      const covered =
        rect !== null && (!hasPageRef.current || isCoveredBy(rect, overlayBoxes(document, root)));
      if (
        lastSent.current === undefined ||
        (rect !== null && zoomChanged) ||
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
      const dtRect = visible && devtoolsDockedRef.current ? readBox(stageRef.current) : null;
      const dtCovered = dtRect !== null && isCoveredBy(dtRect, overlayBoxes(document, root));
      if (
        lastDt.current === undefined ||
        (dtRect !== null && zoomChanged) ||
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
  }, [conversationId, tabId, panelApi, hostVisible, setMultiMode]);

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

  /** 多点模式开关：开启即进入圈选，关闭顺手收起圈选层，免得继续往清单里加 */
  const toggleMulti = () => {
    setMultiMode(!multiRef.current);
  };

  /**
   * 清单一次性合并进当前 Composer：位置引用 + 备注 + 截图按顺序插入，
   * 不自动发送（保留用户确认）；Composer 不在线时一条都不插，清单原样留着。
   */
  const submitAnnotations = () => {
    if (annotations.length === 0) return;
    if (!insertUiElementMentions(annotations.map(annotationMentionInsert), conversationId)) {
      addToast({ type: 'warning', title: t('No Composer for this selection') });
      return;
    }
    clearAnnotations(annotationKey);
    setMultiMode(false);
    requestFocusComposer();
  };

  /** 拖拽设备框边缘：框保持居中，边缘跟手需要按 2 倍位移换算逻辑尺寸 */
  const onDeviceResize =
    (axis: 'x' | 'y' | 'xy') => (event: React.PointerEvent<HTMLDivElement>) => {
      // DevTools 占着 CDP 时改尺寸必然被 Main 拒绝，别让拖拽发出注定失败的操作
      if (!device || !frame || state.devtoolsOpen) return;
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
  // 舞台底色在设备框处挖空，浮层压住网页时 guest 才能从洞里透出来
  const stageClip = stage && frame ? deviceStageClip(stage, frame) : undefined;
  const canOpenExternal = /^https?:/.test(state.url);
  const handle =
    'absolute z-10 flex items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-xs transition-colors hover:text-foreground';

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex h-[calc(40rem/14)] shrink-0 items-center gap-0.5 border-b border-line px-2">
        <Button
          variant="ghost"
          size="icon-xs"
          className={iconButton}
          disabled={!state.canGoBack}
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
          disabled={!state.canGoForward}
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
          disabled={!state.tabId}
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
            className="h-8 w-full min-w-0 rounded-lg border border-border/70 bg-muted/50 pl-8 pr-3 text-[calc(11rem/14)] text-foreground outline-none transition-[background-color,border-color,box-shadow] placeholder:text-muted-foreground/72 hover:bg-muted/70 focus:border-ring focus:bg-background focus:ring-2 focus:ring-ring/25"
          />
        </form>
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
          disabled={!state.tabId || state.devtoolsOpen}
          onClick={() => {
            if (multiRef.current) setMultiMode(false);
            else {
              discardLatePick.current = state.designMode;
              requestDesignMode(!state.designMode);
            }
          }}
          aria-label={t('Toggle Design Mode')}
          title={t('Toggle Design Mode')}
          aria-pressed={state.designMode}
        >
          <SquareDashedMousePointer className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          className={cn(iconButton, multi && 'bg-muted text-foreground')}
          disabled={!state.tabId || state.devtoolsOpen}
          onClick={toggleMulti}
          aria-label={t('Multi-point annotation')}
          title={t('Multi-point annotation')}
          aria-pressed={multi}
        >
          <ListPlus className="size-4" />
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
              // DevTools 开着时不能启用或改尺寸，但关掉预览不碰 CDP，仍要放行
              disabled={state.devtoolsOpen && !device}
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
          </MenuPopup>
        </Menu>
      </div>
      {device && (
        <BrowserDeviceToolbar
          device={device}
          scale={frame?.scale ?? null}
          liveSize={liveSize}
          disabled={false}
          devtoolsOpen={state.devtoolsOpen}
          background={stageBackground}
          onBackgroundChange={setStageBackground}
          onApply={applyDevice}
        />
      )}
      {error && (
        <div
          role="alert"
          className="break-words border-b bg-destructive/10 px-3 py-1 text-[calc(11rem/14)] text-destructive"
        >
          {error}
        </div>
      )}
      {(multi || annotations.length > 0) && (
        <div
          data-slot="browser-annotation-list"
          className="shrink-0 border-b bg-muted/30 px-2 py-1.5"
        >
          <div className="flex items-center gap-2">
            <ListPlus className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="shrink-0 text-[calc(11rem/14)] font-medium">{t('Annotations')}</span>
            <span className="shrink-0 text-[calc(11rem/14)] tabular-nums text-muted-foreground">
              {annotations.length}
            </span>
            <span className="min-w-0 flex-1 truncate text-[calc(11rem/14)] text-muted-foreground">
              {t('Pick several elements or regions, then add them together.')}
            </span>
            <Button
              variant="ghost"
              size="xs"
              disabled={annotations.length === 0}
              onClick={submitAnnotations}
              title={t('Add to conversation')}
            >
              {t('Add to conversation')}
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              className={iconButton}
              disabled={annotations.length === 0}
              onClick={() => clearAnnotations(annotationKey)}
              aria-label={t('Clear annotations')}
              title={t('Clear annotations')}
            >
              <X className="size-3.5" />
            </Button>
          </div>
          {annotations.length > 0 && (
            <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto">
              {annotations.map((entry, index) => (
                <li
                  key={entry.id}
                  data-slot="browser-annotation"
                  data-kind={entry.kind}
                  className="flex items-center gap-2"
                >
                  <span className="w-4 shrink-0 text-right text-[calc(10rem/14)] tabular-nums text-muted-foreground">
                    {index + 1}
                  </span>
                  {entry.image && (
                    <img
                      src={`data:${entry.image.mimeType};base64,${entry.image.data}`}
                      alt=""
                      className="size-6 shrink-0 rounded border border-border/70 object-cover"
                    />
                  )}
                  <span
                    className="max-w-28 shrink-0 truncate text-[calc(11rem/14)]"
                    title={`${entry.path}${entry.text ? ` · ${entry.text}` : ''}`}
                  >
                    {entry.kind === 'region' ? t('Region') : entry.label}
                  </span>
                  <input
                    value={entry.note}
                    onChange={(event) =>
                      updateAnnotationNote(annotationKey, entry.id, event.target.value)
                    }
                    placeholder={t('Note for selection')}
                    aria-label={t('Note for selection')}
                    spellCheck={false}
                    className="h-6 min-w-0 flex-1 rounded-md border border-border/70 bg-background px-2 text-[calc(11rem/14)] text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground/72 focus:border-ring focus:ring-2 focus:ring-ring/25"
                  />
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className={iconButton}
                    onClick={() => removeAnnotation(annotationKey, entry.id)}
                    aria-label={t('Remove annotation')}
                    title={t('Remove annotation')}
                  >
                    <X className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col" data-slot="browser-native-stack">
        <div
          ref={stageRef}
          className={cn(
            'relative min-h-0 flex-1 overflow-hidden',
            device && !devtoolsDocked && 'flex items-center justify-center'
          )}
        >
          {device && !devtoolsDocked && (
            <div
              aria-hidden
              data-slot="browser-stage-backdrop"
              className={cn('pointer-events-none absolute inset-0', stageBackgroundClass)}
              style={stageClip ? { clipPath: stageClip } : undefined}
            />
          )}
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
            {frame && !state.devtoolsOpen && (
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
        </div>
      </div>
      <BrowserHistoryPanel
        open={panel === 'history'}
        onOpenChange={(open) => setPanel(open ? 'history' : null)}
        conversationId={conversationId}
        onNavigate={navigate}
        navigationDisabled={false}
      />
      <BrowserDownloadsPanel
        open={panel === 'downloads'}
        onOpenChange={(open) => setPanel(open ? 'downloads' : null)}
        conversationId={conversationId}
      />
    </div>
  );
}
