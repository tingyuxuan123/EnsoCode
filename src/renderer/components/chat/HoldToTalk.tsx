import type { StartVoiceSession } from '@shared/types/speech';
import { Keyboard, Mic, X } from 'lucide-react';
import { type PointerEvent, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Spinner } from '@/components/ui/spinner';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { ensureMicPermission, primeVoiceAudio, releaseVoiceAudio } from '@/lib/voiceCapture';
import { Z_INDEX } from '@/lib/z-index';
import { inCancelZone, pushLevel, releaseAction, WAVE_BARS } from './holdGesture';
import { micErrorKey, useVoiceInput, type VoicePhase } from './useVoiceInput';
import { ICON_BUTTON, VoiceNote } from './VoiceInputButton';

const PREVIEW_CHARS = 200;
const BAR_KEYS = Array.from({ length: WAVE_BARS }, (_, i) => `bar-${i}`);
const SILENT = pushLevel([], 0);

/**
 * 工具栏里的麦克风 / 键盘切换。切到按住说话前先在这次点击里备好音频、走完麦克风授权：
 * 授权弹窗若等到按住时才出，会打断那次按住。
 */
export function HoldToTalkToggle({
  active,
  disabled,
  onChange,
}: {
  active: boolean;
  disabled?: boolean;
  onChange: (active: boolean) => void;
}) {
  const { t } = useI18n();
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(timer);
  }, [error]);

  const enable = async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(t('Voice input needs a secure (HTTPS) connection.'));
      return;
    }
    primeVoiceAudio();
    setAsking(true);
    try {
      await ensureMicPermission();
      onChange(true);
    } catch (cause) {
      setError(t(micErrorKey(cause)));
    } finally {
      setAsking(false);
    }
  };

  const label = t(active ? 'Switch to keyboard' : 'Voice input');
  return (
    <div ref={anchorRef} className="flex shrink-0 items-center">
      <button
        type="button"
        disabled={disabled || asking}
        onClick={() => (active ? onChange(false) : void enable())}
        aria-label={label}
        title={label}
        className={ICON_BUTTON}
      >
        {asking ? (
          <Spinner className="h-3.5 w-3.5" />
        ) : active ? (
          <Keyboard className="h-3.5 w-3.5" />
        ) : (
          <Mic className="h-3.5 w-3.5" />
        )}
      </button>
      {error && anchorRef.current ? (
        <VoiceNote anchor={anchorRef.current} status>
          {error}
        </VoiceNote>
      ) : null}
    </div>
  );
}

let pendingRelease: ReturnType<typeof setTimeout> | undefined;

/** 微信式按住说话：按下开录，上滑取消，松手识别，纠错完才撤掉蒙层 */
export function HoldToTalk({
  startSession,
  disabled,
  onText,
}: {
  startSession: StartVoiceSession;
  disabled?: boolean;
  onText: (text: string) => void;
}) {
  const { t } = useI18n();
  const { phase, elapsed, error, setError, partial, correcting, start, finish, cancel } =
    useVoiceInput({ startSession, onText });
  const [levels, setLevels] = useState(SILENT);
  const [held, setHeld] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const pressRef = useRef<{ id: number; y: number; at: number; shifted: boolean } | null>(null);

  useEffect(() => {
    // StrictMode 开发期会卸了再装：推迟一拍关，重新挂上就不关
    clearTimeout(pendingRelease);
    return () => {
      pendingRelease = setTimeout(releaseVoiceAudio, 0);
    };
  }, []);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!held || !viewport) return;
    // 收键盘会挪视口：手指没动坐标却跳了，跳变后的下一个点重新当起点，免得误判上滑取消
    const shift = () => {
      if (pressRef.current) pressRef.current.shifted = true;
    };
    viewport.addEventListener('resize', shift);
    viewport.addEventListener('scroll', shift);
    return () => {
      viewport.removeEventListener('resize', shift);
      viewport.removeEventListener('scroll', shift);
    };
  }, [held]);

  const press = (event: PointerEvent<HTMLButtonElement>) => {
    if (disabled || pressRef.current || phase !== 'idle') return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    // preventDefault 挡住了按钮抢焦点，得手动失焦才会收起软键盘
    (document.activeElement as HTMLElement | null)?.blur();
    event.currentTarget.setPointerCapture(event.pointerId);
    pressRef.current = {
      id: event.pointerId,
      y: event.clientY,
      at: performance.now(),
      shifted: false,
    };
    setHeld(true);
    setCancelling(false);
    setLevels(SILENT);
    void start({
      context: primeVoiceAudio(),
      onLevel: (level) => setLevels((prev) => pushLevel(prev, level)),
    });
  };

  const release = (event: PointerEvent<HTMLButtonElement>, interrupted: boolean) => {
    const current = pressRef.current;
    if (!current || current.id !== event.pointerId) return;
    pressRef.current = null;
    setHeld(false);
    setCancelling(false);
    const action = releaseAction({
      phase,
      heldMs: performance.now() - current.at,
      cancelZone: interrupted || (!current.shifted && inCancelZone(current.y, event.clientY)),
    });
    if (action === 'finish') void finish();
    else if (action !== 'none') cancel();
    // 松手才算用户激活。stop/cancel 已停掉麦克风并关掉这次用过的共享上下文；
    // 这里再丢掉尚未开录的那只，并建一个新的，下次按下才能录。
    releaseVoiceAudio();
    primeVoiceAudio();
    if (action === 'too-short') setError(t('Speech was too short.'));
  };

  const overlay =
    (held && (phase === 'starting' || phase === 'recording')) || phase === 'transcribing';

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onPointerDown={press}
        onPointerMove={(event) => {
          const current = pressRef.current;
          if (current?.id === event.pointerId) {
            if (current.shifted) {
              current.y = event.clientY;
              current.shifted = false;
            }
            setCancelling(inCancelZone(current.y, event.clientY));
          }
        }}
        onPointerUp={(event) => release(event, false)}
        onPointerCancel={(event) => release(event, true)}
        onContextMenu={(event) => event.preventDefault()}
        className={cn(
          'mt-2 flex h-11 w-full touch-none select-none items-center justify-center rounded-xl border bg-background font-medium text-sm shadow-float transition-[opacity,scale,background-color] duration-200 ease-out [-webkit-touch-callout:none] starting:scale-x-25 starting:opacity-0 disabled:opacity-40',
          held && 'bg-accent',
          error && 'text-destructive'
        )}
      >
        {error ?? t(held ? 'Release to finish' : 'Hold to talk')}
      </button>
      {overlay ? (
        <HoldOverlay
          phase={phase}
          cancelling={cancelling}
          elapsed={elapsed}
          levels={levels}
          partial={partial}
          correcting={correcting}
        />
      ) : null}
    </>
  );
}

function HoldOverlay({
  phase,
  cancelling,
  elapsed,
  levels,
  partial,
  correcting,
}: {
  phase: VoicePhase;
  cancelling: boolean;
  elapsed: number;
  levels: readonly number[];
  partial: string;
  correcting: boolean;
}) {
  const { t } = useI18n();
  const busy = phase === 'transcribing';
  const preview = partial.length > PREVIEW_CHARS ? `…${partial.slice(-PREVIEW_CHARS)}` : partial;
  return createPortal(
    <div
      data-testid="hold-to-talk"
      style={{ zIndex: Z_INDEX.TOAST }}
      className="fixed inset-0 flex touch-none select-none flex-col overflow-hidden bg-black/60 backdrop-blur-[2px]"
    >
      <div className="flex flex-1 items-center justify-center px-6">
        <div
          role="status"
          aria-live="polite"
          className={cn(
            'flex min-w-36 max-w-[85vw] flex-col items-center gap-3 rounded-2xl px-5 py-4 shadow-lg transition-colors duration-150',
            cancelling ? 'bg-destructive text-white' : 'bg-brand text-brand-foreground'
          )}
        >
          {preview ? (
            <p data-testid="voice-partial" className="text-[calc(15rem/14)] leading-relaxed">
              {preview}
            </p>
          ) : phase === 'recording' ? (
            <p className="text-sm">{t('Speak now')}</p>
          ) : null}
          {busy || phase === 'starting' ? (
            <span className="flex items-center gap-1.5 text-[calc(11rem/14)] opacity-85">
              <Spinner aria-hidden className="size-3.5" />
              {t(
                phase === 'starting'
                  ? 'Getting the microphone ready…'
                  : correcting
                    ? 'Correcting…'
                    : 'Transcribing…'
              )}
            </span>
          ) : (
            <span aria-hidden className="flex h-8 items-center gap-[3px]">
              {BAR_KEYS.map((key, i) => (
                <span
                  key={key}
                  className="w-[3px] rounded-full bg-current transition-[height] duration-100 ease-out"
                  style={{ height: 4 + levels[i] * 28 }}
                />
              ))}
            </span>
          )}
        </div>
      </div>
      {busy ? null : (
        <div className="flex flex-col items-center">
          <span
            className={cn(
              'mb-3 flex size-14 items-center justify-center rounded-full transition-[scale,background-color,color] duration-150',
              cancelling ? 'scale-110 bg-white text-destructive' : 'bg-white/15 text-white/80'
            )}
          >
            <X className="size-6" />
          </span>
          <p className="mb-5 text-white/80 text-[calc(11rem/14)]">
            {t(cancelling ? 'Release to cancel' : 'Slide up to cancel')}
          </p>
          <div
            className={cn(
              'flex h-[calc(7rem+env(safe-area-inset-bottom))] w-[140%] flex-col items-center rounded-t-[50%] pt-8 transition-colors duration-150',
              cancelling ? 'bg-neutral-500 text-white/70' : 'bg-neutral-100 text-neutral-700'
            )}
          >
            <span className="text-sm">{t('Release to finish')}</span>
            <span className="mt-1 text-[calc(11rem/14)] tabular-nums opacity-60">
              {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
            </span>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}
