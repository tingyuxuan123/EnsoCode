import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '@/i18n';
import { type BusyPhase, formatElapsed } from './busyStatus';
import { CodeKilnWorkingIcon, type WorkingIconPhase } from './CodeKilnWorkingIcon';
import {
  buildTypeSchedule,
  computeCycleTimings,
  cuedMusings,
  evaluateMusingFrame,
  generalMusings,
  type MusingCue,
  pickNextPhrase,
  stripTrailingEllipsis,
} from './workingMusings';

const PHASE_SR_LABEL: Record<BusyPhase, string> = {
  working: 'Working…',
  thinking: 'Thinking…',
  writing: 'Writing reply…',
  tool: 'Running…',
};

const DOT_KEYS = ['d0', 'd1', 'd2'] as const;
const FRAME_INTERVAL_MS = 33;

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(media.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    media.addEventListener?.('change', onChange);
    return () => media.removeEventListener?.('change', onChange);
  }, []);

  return reduced;
}

const ElapsedTimer = memo(function ElapsedTimer({
  since,
  locale,
}: {
  since: number;
  locale: 'en' | 'zh';
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <span
      data-working-elapsed=""
      aria-hidden="true"
      className="font-mono text-[calc(11.5rem/14)] text-muted-foreground/55 tabular-nums select-none"
    >
      {formatElapsed(Date.now() - since, locale)}
    </span>
  );
});

interface PhraseTurn {
  modeKey: string;
  phrase: string;
  typedAt: number[];
  cycle: number;
}

function MusingText({
  modeKey,
  general,
  cued,
  rolls,
  random,
}: {
  modeKey: string;
  general: readonly string[];
  cued: readonly string[];
  rolls: boolean;
  random?: () => number;
}) {
  const rng = random ?? Math.random;
  const reducedMotion = useReducedMotion();

  const [turn, setTurn] = useState<PhraseTurn>(() => {
    const phrase = pickNextPhrase({ general, cued, random: rng });
    return {
      modeKey,
      phrase,
      typedAt: buildTypeSchedule(Array.from(phrase), rng),
      cycle: 0,
    };
  });

  // Only swap immediately on real mode/locale transitions (e.g., loading -> whimsical,
  // whimsical -> compacting/approval, or switching UI language). While remaining in
  // whimsical mode, let the active phrase finish its natural cycle and pick up new cues next.
  if (turn.modeKey !== modeKey) {
    const nextPhrase = pickNextPhrase({ general, cued, random: rng });
    setTurn({
      modeKey,
      phrase: nextPhrase,
      typedAt: buildTypeSchedule(Array.from(nextPhrase), rng),
      cycle: turn.cycle + 1,
    });
  }

  const latestPoolRef = useRef({ modeKey, general, cued, rolls, rng });
  latestPoolRef.current = { modeKey, general, cued, rolls, rng };

  const glyphs = useMemo(
    () =>
      Array.from(turn.phrase).map((char, index) => ({
        key: `${turn.cycle}-${index}-${char.codePointAt(0) ?? 0}`,
        char,
      })),
    [turn.cycle, turn.phrase]
  );

  const trackRef = useRef<HTMLSpanElement | null>(null);
  const charRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const dotRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const caretRef = useRef<HTMLSpanElement | null>(null);

  // Trim stale ref slots when a shorter phrase replaces a longer one.
  charRefs.current.length = glyphs.length;

  useIsomorphicLayoutEffect(() => {
    const charEls = charRefs.current;
    const dotEls = dotRefs.current;
    const caretEl = caretRef.current;

    if (reducedMotion) {
      for (const el of charEls) {
        if (el) el.style.opacity = '1';
      }
      for (const el of dotEls) {
        if (el) el.style.opacity = '0.45';
      }
      if (caretEl) caretEl.style.opacity = '0';
      return;
    }

    const measureStops = (): number[] => {
      const stops: number[] = [0];
      for (let i = 0; i < glyphs.length; i += 1) {
        const el = charEls[i];
        stops.push(el ? el.offsetLeft + el.offsetWidth : (stops[stops.length - 1] ?? 0));
      }
      return stops;
    };

    let caretStops = measureStops();
    let maxCaretX = Math.max(0, (trackRef.current?.clientWidth ?? Number.POSITIVE_INFINITY) - 2);
    const timings = computeCycleTimings(turn.typedAt, rolls);

    const lastCharQ = new Array<number>(glyphs.length).fill(-1);
    const lastDotQ = [-1, -1, -1];
    let lastCaretX = Number.NaN;
    let lastCaretQ = -1;

    const paint = (t: number) => {
      const frame = evaluateMusingFrame(t, turn.typedAt, rolls, glyphs.length);
      for (let i = 0; i < glyphs.length; i += 1) {
        const q = Math.round((frame.letterOpacities[i] ?? 1) * 64);
        if (q !== lastCharQ[i]) {
          lastCharQ[i] = q;
          const el = charEls[i];
          if (el) el.style.opacity = String(q / 64);
        }
      }
      for (let k = 0; k < 3; k += 1) {
        const q = Math.round(frame.dotOpacities[k]! * 64);
        if (q !== lastDotQ[k]) {
          lastDotQ[k] = q;
          const el = dotEls[k];
          if (el) el.style.opacity = String(q / 64);
        }
      }
      if (!caretEl) return;
      if (!frame.showCaret) {
        if (lastCaretQ !== 0) {
          lastCaretQ = 0;
          caretEl.style.opacity = '0';
        }
        return;
      }
      const idx = frame.caretSegmentIndex;
      const rawX =
        idx < 0
          ? (caretStops[0] ?? 0)
          : (caretStops[idx] ?? 0) +
            ((caretStops[idx + 1] ?? caretStops[idx] ?? 0) - (caretStops[idx] ?? 0)) *
              frame.caretSegmentProgress;
      const clampedX = Math.min(rawX + 2, maxCaretX);
      const xq = Math.round(clampedX * 2) / 2;
      const oq = Math.round(frame.caretOpacity * 64);
      if (xq !== lastCaretX) {
        lastCaretX = xq;
        caretEl.style.transform = `translate3d(${xq}px, -50%, 0)`;
      }
      if (oq !== lastCaretQ) {
        lastCaretQ = oq;
        caretEl.style.opacity = String((oq / 64) * 0.72);
      }
    };

    // Paint t = 0 before first frame so glyphs never flash full-opacity before typing starts.
    paint(0);

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && trackRef.current) {
      observer = new ResizeObserver(() => {
        caretStops = measureStops();
        maxCaretX = Math.max(0, (trackRef.current?.clientWidth ?? Number.POSITIVE_INFINITY) - 2);
      });
      observer.observe(trackRef.current);
    }

    const startMs = performance.now();
    let lastTickMs = startMs;
    let rafId = 0;
    let cancelled = false;

    const step = (now: number) => {
      if (cancelled) return;
      if (now - lastTickMs >= FRAME_INTERVAL_MS) {
        lastTickMs = now;
        const elapsed = now - startMs;
        if (elapsed >= timings.cycleMs) {
          const latest = latestPoolRef.current;
          setTurn((prev) => {
            if (latest.rolls) {
              const nextPhrase = pickNextPhrase({
                general: latest.general,
                cued: latest.cued,
                avoid: prev.phrase,
                random: latest.rng,
              });
              return {
                modeKey: latest.modeKey,
                phrase: nextPhrase,
                typedAt: buildTypeSchedule(Array.from(nextPhrase), latest.rng),
                cycle: prev.cycle + 1,
              };
            }
            return {
              modeKey: latest.modeKey,
              phrase: prev.phrase,
              typedAt: [],
              cycle: prev.cycle + 1,
            };
          });
          return;
        }
        paint(elapsed);
      }
      rafId = window.requestAnimationFrame(step);
    };

    rafId = window.requestAnimationFrame(step);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(rafId);
      observer?.disconnect();
    };
  }, [glyphs.length, reducedMotion, rolls, turn]);

  return (
    <span
      ref={trackRef}
      aria-hidden="true"
      data-musing-phrase={turn.phrase}
      className="codekiln-working-label relative inline-block max-w-full overflow-hidden text-ellipsis whitespace-pre pr-[calc(3rem/14)] text-[calc(13rem/14)] leading-[calc(20rem/14)] font-normal text-foreground/85 select-none"
    >
      {glyphs.map((glyph, index) => (
        <span
          key={glyph.key}
          ref={(el) => {
            charRefs.current[index] = el;
          }}
        >
          {glyph.char}
        </span>
      ))}
      {DOT_KEYS.map((dotKey, index) => (
        <span
          key={dotKey}
          className="text-foreground/55"
          ref={(el) => {
            dotRefs.current[index] = el;
          }}
        >
          .
        </span>
      ))}
      <span ref={caretRef} className="codekiln-musing-caret" />
    </span>
  );
}

/**
 * Borderless timeline activity row: 6-frame blooming spark aligned to the step icon column,
 * hand-typed contextual musings with breathing dots, and a quiet elapsed timer.
 */
export function WorkingStatus({
  loading,
  phase,
  since,
  cue = null,
  compacting = false,
  waitingForApproval = false,
  random,
}: {
  loading: boolean;
  phase: BusyPhase;
  since?: number;
  cue?: MusingCue | null;
  compacting?: boolean;
  waitingForApproval?: boolean;
  random?: () => number;
}) {
  const { t, locale } = useI18n();
  const activePhase: WorkingIconPhase = loading ? 'loading' : waitingForApproval ? 'tool' : phase;

  const srLabel = loading
    ? t('Loading…')
    : compacting
      ? t('Compacting…')
      : waitingForApproval
        ? t('Waiting for you to handle it')
        : t(PHASE_SR_LABEL[phase]);

  const fixedLabel = loading
    ? stripTrailingEllipsis(t('Loading…'))
    : compacting
      ? stripTrailingEllipsis(t('Compacting…'))
      : waitingForApproval
        ? stripTrailingEllipsis(t('Waiting for you to handle it'))
        : null;

  const general = useMemo(
    () => (fixedLabel !== null ? [fixedLabel] : generalMusings(locale)),
    [fixedLabel, locale]
  );
  const cueTopic = cue?.topic;
  const cueName = cue?.name;
  const cued = useMemo(
    () =>
      fixedLabel !== null || !cueTopic
        ? []
        : cuedMusings({ topic: cueTopic, name: cueName ?? '' }, locale),
    [cueName, cueTopic, fixedLabel, locale]
  );
  const rolls = fixedLabel === null && general.length + cued.length > 1;
  const modeKey = fixedLabel !== null ? `fixed:${locale}:${fixedLabel}` : `whimsical:${locale}`;

  return (
    <div
      data-timeline-busy=""
      className="flex min-h-[calc(34rem/14)] items-center pt-[calc(6rem/14)] pb-[calc(2rem/14)]"
    >
      <div
        data-slot="working-status"
        data-phase={activePhase}
        className="codekiln-working-row inline-flex max-w-full min-w-0 items-center gap-2"
      >
        <CodeKilnWorkingIcon phase={activePhase} />
        <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
          {srLabel}
        </span>
        <span className="flex min-w-0 items-center gap-[calc(6rem/14)]">
          <MusingText
            modeKey={modeKey}
            general={general}
            cued={cued}
            rolls={rolls}
            random={random}
          />
          {!loading && since !== undefined && (
            <>
              <span
                aria-hidden="true"
                className="shrink-0 text-[calc(11rem/14)] text-muted-foreground/35 select-none"
              >
                ·
              </span>
              <ElapsedTimer since={since} locale={locale} />
            </>
          )}
        </span>
      </div>
    </div>
  );
}
