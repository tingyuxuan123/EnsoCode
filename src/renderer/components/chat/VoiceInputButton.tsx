import type { StartVoiceSession } from '@shared/types/speech';
import { Mic, Square, X } from 'lucide-react';
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Spinner } from '@/components/ui/spinner';
import { useI18n } from '@/i18n';
import { eventToBinding, formatBinding, isHoldReleased } from '@/lib/keybindings';
import { Z_INDEX } from '@/lib/z-index';
import { useSettingsStore } from '@/stores/settings';
import { pushLevel, releaseAction, WAVE_BARS } from './holdGesture';
import { useVoiceInput } from './useVoiceInput';
import { voiceNotePlacement } from './voiceNotePlacement';

/** 预览只留最近的一段，长句不撑满屏幕 */
const PREVIEW_CHARS = 120;
/** 工具栏里放不下整段波形，只画最近几格 */
const MINI_BARS = 12;
const MINI_BAR_KEYS = Array.from({ length: MINI_BARS }, (_, i) => `bar-${i}`);
const SILENT = pushLevel([], 0);
/** 长按判定：按下后这么久没松、也没按别的键才开录；短按照常打字 */
const HOLD_DELAY_MS = 300;

type Placement = ReturnType<typeof voiceNotePlacement>;

function measure(anchor: HTMLElement): Placement {
  const rect = anchor.getBoundingClientRect();
  return voiceNotePlacement(rect, { width: window.innerWidth, height: window.innerHeight });
}

/**
 * 输入框工具栏 overflow-hidden 会裁掉绝对定位的气泡，portal 到 body 按按钮位置固定定位。
 * 录音中窗口缩放、侧栏开合都会挪动按钮，逐帧跟随（只在位置变了才重渲染）。
 */
export function VoiceNote({
  anchor,
  status,
  children,
}: {
  anchor: HTMLElement;
  status: boolean;
  children: ReactNode;
}) {
  const [placement, setPlacement] = useState(() => measure(anchor));
  useLayoutEffect(() => {
    let frame = 0;
    const follow = () => {
      const next = measure(anchor);
      setPlacement((prev) =>
        prev.left === next.left && prev.bottom === next.bottom && prev.maxWidth === next.maxWidth
          ? prev
          : next
      );
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(frame);
  }, [anchor]);
  return createPortal(
    <p
      role={status ? 'status' : undefined}
      aria-live="polite"
      data-testid={status ? undefined : 'voice-partial'}
      style={{ position: 'fixed', ...placement, zIndex: Z_INDEX.TOOLTIP }}
      className="w-max rounded-md border bg-popover px-2 py-1 text-popover-foreground text-[calc(11rem/14)] shadow-md"
    >
      {children}
    </p>,
    document.body
  );
}

export const ICON_BUTTON =
  'flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40';

export function VoiceInputButton({
  startSession,
  requestMicAccess,
  disabled,
  holdBinding,
  holdScope,
  onText,
}: {
  startSession: StartVoiceSession;
  requestMicAccess?: () => Promise<boolean>;
  disabled?: boolean;
  /** 长按录音、松开识别的快捷键（仅焦点在 holdScope 内时生效） */
  holdBinding?: string;
  holdScope: RefObject<HTMLElement | null>;
  onText: (text: string) => void;
}) {
  const { t } = useI18n();
  const { phase, elapsed, error, setError, partial, correcting, start, finish, cancel } =
    useVoiceInput({ startSession, requestMicAccess, onText });
  const anchorRef = useRef<HTMLDivElement>(null);
  const [levels, setLevels] = useState(SILENT);
  const deviceId = useSettingsStore((state) => state.voiceInputDevice);
  const begin = (autoStop = false) => {
    setLevels(SILENT);
    return start({
      autoStop,
      deviceId,
      onLevel: (level) => setLevels((prev) => pushLevel(prev, level)),
    });
  };
  const latest = useRef({ phase, start: begin, finish, cancel });
  latest.current = { phase, start: begin, finish, cancel };

  useEffect(() => {
    if (!holdBinding || disabled) return;
    let heldSince: number | null = null;
    let pending: ReturnType<typeof setTimeout> | undefined;
    const abortPending = () => {
      clearTimeout(pending);
      pending = undefined;
    };
    // 裸空格的原生输入已被拦下：没构成长按就补回这个空格
    const flushTap = () => {
      if (pending === undefined) return;
      abortPending();
      if (holdBinding === 'space') document.execCommand('insertText', false, ' ');
    };
    const release = () => {
      abortPending();
      if (heldSince === null) return;
      const voice = latest.current;
      const action = releaseAction({
        phase: voice.phase,
        heldMs: performance.now() - heldSince,
        cancelZone: false,
      });
      heldSince = null;
      if (action === 'finish') void voice.finish();
      else if (action !== 'none') voice.cancel();
      if (action === 'too-short') setError(t('Speech was too short.'));
    };
    const onDown = (event: KeyboardEvent) => {
      // 229：输入法已接管这次按键，拦不住原生输入
      if (event.isComposing || event.keyCode === 229) return;
      if (eventToBinding(event, { allowBare: true }) !== holdBinding) {
        flushTap();
        return;
      }
      const scope = holdScope.current;
      if (!scope || !(event.target instanceof Node) || !scope.contains(event.target)) return;
      const idle = heldSince === null && pending === undefined;
      if (idle && (event.repeat || latest.current.phase !== 'idle')) return;
      event.preventDefault();
      if (heldSince !== null) event.stopPropagation();
      if (!idle) return;
      pending = setTimeout(() => {
        pending = undefined;
        heldSince = performance.now();
        void latest.current.start();
      }, HOLD_DELAY_MS);
    };
    const onUp = (event: KeyboardEvent) => {
      if ((heldSince === null && !pending) || !isHoldReleased(holdBinding, event)) return;
      event.preventDefault();
      flushTap();
      release();
    };
    // 按住时切走窗口收不到 keyup，按松手处理
    window.addEventListener('keydown', onDown, true);
    window.addEventListener('keyup', onUp, true);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('keydown', onDown, true);
      window.removeEventListener('keyup', onUp, true);
      window.removeEventListener('blur', release);
      abortPending();
      if (heldSince !== null) latest.current.cancel();
    };
  }, [disabled, holdBinding, holdScope, setError, t]);

  useEffect(() => {
    if (phase !== 'recording') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      cancel();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [cancel, phase]);

  const preview = partial.length > PREVIEW_CHARS ? `…${partial.slice(-PREVIEW_CHARS)}` : partial;
  const busyLabel =
    phase === 'transcribing' ? t(correcting ? 'Correcting…' : 'Transcribing…') : null;

  return (
    <div ref={anchorRef} className="relative flex shrink-0 items-center">
      {phase === 'recording' ? (
        <>
          <button
            type="button"
            onClick={() => void finish()}
            aria-label={t('Stop recording')}
            title={t('Stop recording')}
            className="flex h-7 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-destructive transition-colors hover:bg-destructive/10"
          >
            <span aria-hidden className="flex h-3.5 items-center gap-[2px]">
              {MINI_BAR_KEYS.map((key, i) => (
                <span
                  key={key}
                  className="w-[2px] rounded-full bg-current transition-[height] duration-100 ease-out"
                  style={{ height: 3 + levels[WAVE_BARS - MINI_BARS + i] * 11 }}
                />
              ))}
            </span>
            <span className="text-[calc(11rem/14)] tabular-nums">
              {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
            </span>
            <Square className="h-3 w-3 fill-current" />
          </button>
          <button
            type="button"
            onClick={cancel}
            aria-label={t('Cancel recording')}
            title={`${t('Cancel recording')} (Esc)`}
            className={ICON_BUTTON}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </>
      ) : (
        <button
          type="button"
          disabled={disabled || phase !== 'idle'}
          onClick={() => void begin(true)}
          aria-label={busyLabel ?? t('Voice input')}
          title={
            busyLabel ??
            (holdBinding
              ? `${t('Voice input')} · ${t('Hold {{key}} to talk', { key: formatBinding(holdBinding) })}`
              : t('Voice input'))
          }
          className={ICON_BUTTON}
        >
          {phase === 'idle' ? <Mic className="h-3.5 w-3.5" /> : <Spinner className="h-3.5 w-3.5" />}
        </button>
      )}
      {anchorRef.current && (error || partial) ? (
        <VoiceNote anchor={anchorRef.current} status={Boolean(error)}>
          {error ??
            (correcting ? (
              <span className="flex items-start gap-1.5">
                <Spinner aria-hidden className="mt-0.5 size-3 shrink-0" />
                <span>
                  <span className="text-muted-foreground">{t('Correcting…')} </span>
                  {preview}
                </span>
              </span>
            ) : (
              preview
            ))}
        </VoiceNote>
      ) : null}
    </div>
  );
}
