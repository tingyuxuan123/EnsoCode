import { memo, useEffect, useState } from 'react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { type BusyPhase, formatElapsed } from './busyStatus';
import { CodeKilnWorkingIcon } from './CodeKilnWorkingIcon';

const LABEL: Record<BusyPhase, string> = {
  working: 'Working…',
  thinking: 'Thinking…',
  writing: 'Writing reply…',
  tool: 'Running…',
};

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
      className="font-mono text-[calc(11rem/14)] text-muted-foreground tabular-nums"
    >
      {formatElapsed(Date.now() - since, locale)}
    </span>
  );
});

/** Refined turn status: Enso orbital beacon, shimmering phase label and localized time. */
export function WorkingStatus({
  loading,
  phase,
  since,
}: {
  loading: boolean;
  phase: BusyPhase;
  since?: number;
}) {
  const { t, locale } = useI18n();
  const activePhase = loading ? 'loading' : phase;
  const label = loading ? t('Loading…') : t(LABEL[phase]);
  const [lastLabel, setLastLabel] = useState(label);
  const [animateSwap, setAnimateSwap] = useState(false);

  if (label !== lastLabel) {
    setLastLabel(label);
    setAnimateSwap(true);
  }

  return (
    <div data-timeline-busy="" className="flex min-h-[calc(44rem/14)] items-center">
      <div
        data-slot="working-status"
        data-phase={activePhase}
        className="codekiln-working-pill inline-flex max-w-full items-center gap-[calc(9rem/14)] rounded-full border border-border/70 bg-card/85 py-[calc(5.5rem/14)] pr-[calc(13rem/14)] pl-[calc(8rem/14)] shadow-xs backdrop-blur-xs"
      >
        <CodeKilnWorkingIcon phase={activePhase} />
        <span className="flex min-w-0 items-baseline gap-[calc(7rem/14)]">
          <span
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="inline-flex min-w-0 items-center overflow-hidden text-[calc(12.5rem/14)] font-medium text-foreground"
          >
            <span
              key={label}
              data-text={label}
              className={cn(
                'codekiln-working-label t-shimmer truncate',
                animateSwap && 'codekiln-working-label-swap'
              )}
            >
              {label}
            </span>
          </span>
          {!loading && since !== undefined && (
            <>
              <span aria-hidden="true" className="text-[calc(11rem/14)] text-muted-foreground/45">
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
