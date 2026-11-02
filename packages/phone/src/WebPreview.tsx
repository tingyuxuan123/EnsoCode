import type {
  PairFileTarget,
  PairPreviewEntry,
  PairPreviewFrame,
  PairPreviewInput,
} from '@enso/pair';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CornerDownLeft,
  Loader2,
  Monitor,
  RefreshCw,
  Smartphone,
} from 'lucide-react';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { PreviewPort, PreviewResult } from './previewPort';
import { previewPoint, previewSwipe } from './previewViewport';

export const WebPreviewContext = createContext<{
  port: PreviewPort;
  available: boolean;
  online: boolean;
  readOnly: boolean;
} | null>(null);
const ERRORS: Record<string, string> = {
  unavailable: '预览已关闭或会话不可用，请重新打开。',
  offline: '电脑已离线，重新连接后再打开预览。',
  timeout: '网页没有及时响应，请确认电脑上的开发服务仍在运行。',
  'not-found': '找不到该页面，请刷新列表。',
  'stale-frame': '页面已变化，正在更新画面，请稍后再操作。',
  'read-only': '此设备为只读，只能查看页面。',
  busy: '预览正在处理，请稍后再试。',
  'rate-limited': '刷新太快，请稍候。',
  'too-large': '页面画面过大，无法通过中继传输。',
  invalid: '预览返回了无效画面，请重新打开。',
};

/** Web 只显示远端隔离浏览器的 JPEG；不嵌入助手生成的 HTML/JS。 */
export function WebPreview({ target, children }: { target: PairFileTarget; children?: ReactNode }) {
  const context = useContext(WebPreviewContext);
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<PairPreviewEntry[]>([]);
  const [frame, setFrame] = useState<PairPreviewFrame | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [mobile, setMobile] = useState(true);
  const [auto, setAuto] = useState(false);
  const [revision, setRevision] = useState(0);
  const idRef = useRef<string | null>(null);
  const frameRef = useRef<PairPreviewFrame | null>(null);
  const displayedFrameRef = useRef<PairPreviewFrame | null>(null);
  const actionBusy = useRef(false);
  const epoch = useRef(0);
  const imageRef = useRef<HTMLImageElement>(null);
  const pointerRef = useRef<{ x: number; y: number; frame: PairPreviewFrame } | null>(null);
  const wheelRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pauseUntil = useRef(0);
  const port = context?.port;
  const online = context?.online ?? false;
  const key = JSON.stringify(target);
  frameRef.current = frame;

  // biome-ignore lint/correctness/useExhaustiveDependencies: key 是完整的 target 身份
  useEffect(() => {
    const generation = ++epoch.current;
    const controller = new AbortController();
    const previous = idRef.current;
    idRef.current = null;
    if (previous) void port?.close(previous);
    setFrame(null);
    displayedFrameRef.current = null;
    setEntries([]);
    setError(null);
    setBusy(false);
    actionBusy.current = false;
    if (open && port) {
      if (!online) setError('offline');
      else {
        setBusy(true);
        void port.list(target, controller.signal).then((result) => {
          if (generation !== epoch.current || controller.signal.aborted) return;
          if ('error' in result) setError(result.error);
          else setEntries(result.entries);
          setBusy(false);
        });
      }
    }
    return () => {
      epoch.current++;
      controller.abort();
      const id = idRef.current;
      idRef.current = null;
      if (id) void port?.close(id);
      if (wheelRef.current) clearTimeout(wheelRef.current);
    };
  }, [open, key, port, online, revision]);

  const apply = useCallback((result: PreviewResult) => {
    if ('error' in result) {
      if (!['cancelled', 'rate-limited'].includes(result.error)) setError(result.error);
      if (['offline', 'unavailable', 'timeout'].includes(result.error)) {
        idRef.current = null;
        setFrame(null);
      }
    } else if (result.frame) {
      if (displayedFrameRef.current?.dataUrl === result.frame.dataUrl) {
        displayedFrameRef.current = result.frame;
      }
      setFrame(result.frame);
      setError(null);
    }
  }, []);

  // 单次完成后才调度下一次；在后台、输入操作在途时不取画面，不累积轮询。
  useEffect(() => {
    if (!open || !online || !port || !auto) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const id = idRef.current;
      const generation = epoch.current;
      if (
        id &&
        !actionBusy.current &&
        Date.now() >= pauseUntil.current &&
        document.visibilityState === 'visible'
      ) {
        actionBusy.current = true;
        try {
          const result = await port.frame(id);
          if (alive && generation === epoch.current && id === idRef.current) apply(result);
        } finally {
          if (generation === epoch.current) actionBusy.current = false;
        }
      }
      if (alive) timer = setTimeout(() => void tick(), 750);
    };
    timer = setTimeout(() => void tick(), 750);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [open, online, port, apply, auto]);

  const choose = async (entry: PairPreviewEntry) => {
    if (!port || actionBusy.current) return;
    const generation = epoch.current;
    setBusy(true);
    setError(null);
    actionBusy.current = true;
    const previous = idRef.current;
    idRef.current = null;
    if (previous) await port.close(previous);
    const result = await port.open(
      target,
      entry.id,
      mobile ? { width: 393, height: 752 } : { width: 1280, height: 800 }
    );
    if (generation !== epoch.current) {
      if ('previewId' in result) void port.close(result.previewId);
      return;
    }
    if ('previewId' in result) idRef.current = result.previewId;
    apply(result);
    setBusy(false);
    actionBusy.current = false;
  };
  const act = async (
    input?: PairPreviewInput,
    inputFrame?: PairPreviewFrame,
    frameOnly = false
  ) => {
    const id = idRef.current;
    const current = input ? (inputFrame ?? displayedFrameRef.current) : frameRef.current;
    if (!port || !id || !current || (input && context?.readOnly)) return false;
    if (actionBusy.current) {
      setError('busy');
      return false;
    }
    pauseUntil.current = Date.now() + 1500;
    const generation = epoch.current;
    actionBusy.current = true;
    setBusy(true);
    try {
      const result = input
        ? await port.input(id, current.frameId, input)
        : frameOnly
          ? await port.frame(id)
          : await port.refresh(id);
      if (generation === epoch.current && id === idRef.current) apply(result);
      return !('error' in result);
    } finally {
      if (generation === epoch.current) {
        actionBusy.current = false;
        setBusy(false);
      }
    }
  };
  const close = (next: boolean) => {
    if (!next) {
      epoch.current++;
      const id = idRef.current;
      idRef.current = null;
      if (id) void port?.close(id);
    }
    setOpen(next);
  };
  if (!context?.available) return null;
  return (
    <>
      <button
        type="button"
        aria-label="网页预览"
        title="网页预览"
        onClick={() => close(true)}
        className={
          children
            ? 'flex items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs'
            : 'flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground'
        }
      >
        {children ?? <Monitor className="h-4.5 w-4.5" />}
      </button>
      <Sheet open={open} onOpenChange={close}>
        <SheetContent side="bottom" className="phone-sheet max-h-[95dvh] pb-safe">
          <SheetHeader className="shrink-0 px-4 pt-7 pb-3">
            <SheetTitle className="font-semibold text-[15px]">网页预览</SheetTitle>
            <SheetDescription>
              画面来自电脑上的隔离浏览器，经加密连接传输。支持点击、滚动和输入；不会把网页代码交给聊天页面执行。
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 overflow-y-auto px-4 pb-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !online}
                onClick={() => {
                  if (frame) void act();
                  else setRevision((n) => n + 1);
                }}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                {frame ? '刷新网页' : '刷新列表'}
              </Button>
              {frame ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || !online}
                    onClick={() => void act(undefined, undefined, true)}
                  >
                    更新画面
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setRevision((n) => n + 1)}>
                    选择其他页面
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-pressed={auto}
                    onClick={() => setAuto(!auto)}
                  >
                    自动更新：{auto ? '开' : '关'}
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setMobile(!mobile)}
                >
                  {mobile ? (
                    <Smartphone className="h-3.5 w-3.5" />
                  ) : (
                    <Monitor className="h-3.5 w-3.5" />
                  )}
                  {mobile ? '手机尺寸' : '桌面尺寸'}
                </Button>
              )}
              {busy && (
                <Loader2
                  aria-label="预览处理中"
                  className="h-4 w-4 animate-spin text-muted-foreground"
                />
              )}
            </div>
            {error && (
              <p role="alert" className="mb-3 text-destructive text-sm">
                {ERRORS[error] ?? '网页预览失败，请刷新列表后重试。'}
              </p>
            )}
            {!frame && (
              <div className="space-y-2">
                {entries.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    disabled={busy || !online}
                    onClick={() => void choose(entry)}
                    className="flex w-full items-center gap-2 rounded-md border px-3 py-3 text-left hover:bg-accent disabled:opacity-50"
                  >
                    <Monitor className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1 break-all text-sm">{entry.label}</span>
                    <span className="shrink-0 text-muted-foreground text-xs">
                      {entry.kind === 'server' ? '开发服务' : 'HTML'}
                    </span>
                  </button>
                ))}
                {!busy && entries.length === 0 && (
                  <div className="rounded-md border border-dashed p-5 text-muted-foreground text-sm">
                    还没有可预览的页面。HTML 请保存到项目目录；React / Vue
                    请让助手启动开发服务，并在回复中给出 localhost 地址，再刷新列表。
                  </div>
                )}
                <p className="text-muted-foreground text-xs">
                  此版本只加载项目本地资源，外部 CDN、外部网站跳转和文件上传暂不支持。
                </p>
              </div>
            )}
            {frame && (
              <>
                <p className="mb-1 truncate text-muted-foreground text-xs">
                  {frame.title || '网页'} · {frame.width} × {frame.height}
                  {context.readOnly ? ' · 只读查看' : ' · 点击画面操作，滑动滚动'}
                </p>
                <div className="rounded-md border bg-white">
                  <img
                    ref={imageRef}
                    src={frame.dataUrl}
                    alt="网页实时预览画面"
                    draggable={false}
                    onLoad={() => {
                      displayedFrameRef.current = frame;
                    }}
                    tabIndex={context.readOnly ? undefined : 0}
                    className="mx-auto block h-auto max-h-[60dvh] w-auto max-w-full select-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    style={{ touchAction: context.readOnly ? 'auto' : 'none' }}
                    onPointerDown={(event) => {
                      if (!context.readOnly) {
                        pauseUntil.current = Date.now() + 1500;
                        const displayed = displayedFrameRef.current;
                        if (!displayed) return;
                        pointerRef.current = {
                          x: event.clientX,
                          y: event.clientY,
                          frame: displayed,
                        };
                        event.currentTarget.setPointerCapture(event.pointerId);
                        event.currentTarget.focus();
                      }
                    }}
                    onPointerCancel={() => {
                      pointerRef.current = null;
                    }}
                    onPointerUp={(event) => {
                      const start = pointerRef.current;
                      pointerRef.current = null;
                      if (!start || context.readOnly) return;
                      const rect = event.currentTarget.getBoundingClientRect();
                      const swipe = previewSwipe(
                        start,
                        { x: event.clientX, y: event.clientY },
                        rect,
                        start.frame
                      );
                      if (swipe) void act({ kind: 'scroll', ...swipe }, start.frame);
                      else {
                        const point = previewPoint(event.clientX, event.clientY, rect, start.frame);
                        if (point) void act({ kind: 'click', ...point }, start.frame);
                      }
                    }}
                    onWheel={(event) => {
                      if (context.readOnly) return;
                      const deltaY = Math.max(-2000, Math.min(2000, event.deltaY));
                      if (wheelRef.current) clearTimeout(wheelRef.current);
                      wheelRef.current = setTimeout(
                        () => void act({ kind: 'scroll', deltaX: 0, deltaY }),
                        100
                      );
                    }}
                    onKeyDown={(event) => {
                      if (
                        [
                          'Enter',
                          'Tab',
                          'Escape',
                          'Backspace',
                          'ArrowUp',
                          'ArrowDown',
                          'ArrowLeft',
                          'ArrowRight',
                        ].includes(event.key)
                      ) {
                        event.preventDefault();
                        void act({
                          kind: 'key',
                          key: event.key as Extract<PairPreviewInput, { kind: 'key' }>['key'],
                        });
                      } else if (
                        event.key.length === 1 &&
                        !event.ctrlKey &&
                        !event.metaKey &&
                        !event.altKey
                      ) {
                        event.preventDefault();
                        void act({ kind: 'text', text: event.key });
                      }
                    }}
                  />
                </div>
                {!context.readOnly && (
                  <div className="mt-2 space-y-2">
                    <form
                      className="flex gap-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (text) {
                          const value = text;
                          void act({ kind: 'text', text: value }).then((ok) => {
                            if (ok) setText((current) => (current === value ? '' : current));
                          });
                        }
                      }}
                    >
                      <input
                        aria-label="向网页输入文字"
                        value={text}
                        maxLength={2000}
                        onFocus={() => {
                          pauseUntil.current = Date.now() + 60_000;
                        }}
                        onBlur={() => {
                          pauseUntil.current = Date.now() + 1500;
                        }}
                        onChange={(event) => setText(event.target.value)}
                        placeholder="先点网页输入框，再输入文字"
                        className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm"
                      />
                      <Button type="submit" size="sm" disabled={busy || !text}>
                        输入
                      </Button>
                    </form>
                    <div className="flex flex-wrap gap-1.5">
                      {(['Tab', 'Enter', 'Backspace'] as const).map((key) => (
                        <Button
                          key={key}
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => void act({ kind: 'key', key })}
                        >
                          {key === 'Enter' ? <CornerDownLeft className="h-3.5 w-3.5" /> : null}
                          {key === 'Backspace' ? '退格' : key}
                        </Button>
                      ))}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        aria-label="向上滚动网页"
                        onClick={() => void act({ kind: 'scroll', deltaX: 0, deltaY: -400 })}
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        aria-label="向下滚动网页"
                        onClick={() => void act({ kind: 'scroll', deltaX: 0, deltaY: 400 })}
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        aria-label="向左滚动网页"
                        onClick={() => void act({ kind: 'scroll', deltaX: -300, deltaY: 0 })}
                      >
                        <ArrowLeft className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        aria-label="向右滚动网页"
                        onClick={() => void act({ kind: 'scroll', deltaX: 300, deltaY: 0 })}
                      >
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
