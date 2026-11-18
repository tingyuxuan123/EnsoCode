import { memo, useEffect, useState } from 'react';
import { useI18n } from '@/i18n';
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

/** Refined turn status: one moving presence indicator, a phase label and localized time. */
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
  return (
    <div data-timeline-busy="" className="flex min-h-[calc(44rem/14)] items-center">
      <div
        data-slot="working-status"
        className="inline-flex max-w-full items-center gap-[10px] rounded-2xl border border-border/80 bg-card/90 px-[11px] py-[7px] shadow-xs"
      >
        <CodeKilnWorkingIcon />
        <span className="flex min-w-0 items-baseline gap-[7px]">
          <span
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="truncate text-[calc(12.5rem/14)] font-medium text-foreground"
          >
            {loading ? t('Loading…') : t(LABEL[phase])}
          </span>
          {!loading && since !== undefined && (
            <>
              <span aria-hidden="true" className="text-[calc(11rem/14)] text-border">
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
