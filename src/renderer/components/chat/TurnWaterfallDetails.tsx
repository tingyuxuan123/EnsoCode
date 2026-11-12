import { ChartGantt, ChevronRight } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { formatDuration } from '@/stores/sessions/stats';
import type { TurnWaterfall, WaterfallSpan } from '@/stores/sessions/turnWaterfall';

const labelKeys = {
  model: 'Model request',
  tool: 'Tool execution',
  input: 'Waiting for your answer',
  gap: 'Unattributed wait',
} as const;

const colors = {
  model: 'bg-primary/75',
  tool: 'bg-foreground/55',
  input: 'bg-amber-500/55',
  gap: 'bg-muted-foreground/25',
} as const;

const formatTiming = (ms: number) => (ms < 1_000 ? `${Math.round(ms)} ms` : formatDuration(ms));

function segmentStyle(start: number, end: number, total: number) {
  return { left: `${(start / total) * 100}%`, width: `${((end - start) / total) * 100}%` };
}

function SpanBar({ span, total }: { span: WaterfallSpan; total: number }) {
  return (
    <span className="relative h-2 min-w-0 rounded-full bg-muted" aria-hidden="true">
      <span
        className={cn('absolute inset-y-0 rounded-full', colors[span.kind])}
        style={segmentStyle(span.start, span.end, total)}
      />
      {span.first !== undefined && (
        <span
          className="absolute inset-y-0 rounded-l-full bg-primary/35"
          style={segmentStyle(span.start, span.first, total)}
        />
      )}
      {span.first !== undefined && span.thought !== undefined && (
        <span
          className="absolute inset-y-0 bg-primary"
          style={segmentStyle(span.first, span.thought, total)}
        />
      )}
    </span>
  );
}

export function TurnWaterfallDetails({ waterfall }: { waterfall: TurnWaterfall }) {
  const { t } = useI18n();
  return (
    <details
      data-slot="turn-waterfall"
      className="group/waterfall mt-2 max-w-xl text-xs leading-normal text-muted-foreground"
    >
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-sm py-1 hover:text-foreground [&::-webkit-details-marker]:hidden">
        <ChartGantt aria-hidden="true" className="size-3.5" />
        <span>{t('Turn timing')}</span>
        <span className="tabular-nums">· {formatTiming(waterfall.elapsedMs)}</span>
        <ChevronRight aria-hidden="true" className="size-3 group-open/waterfall:rotate-90" />
      </summary>
      <ol className="mt-1 max-h-64 space-y-2 overflow-y-auto rounded-lg bg-muted/25 p-2.5">
        {waterfall.spans.map((span, i) => (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: static rows; simultaneous tool spans can have identical times and names.
            key={`${i}-${span.kind}-${span.start}`}
            className="grid grid-cols-[minmax(5rem,0.8fr)_minmax(2rem,1fr)_4rem] items-center gap-x-2 gap-y-0.5"
          >
            <span className="truncate" title={span.name || t(labelKeys[span.kind])}>
              {span.name || t(labelKeys[span.kind])}
            </span>
            <SpanBar span={span} total={waterfall.elapsedMs} />
            <span className="text-right tabular-nums">{formatTiming(span.end - span.start)}</span>
            {(span.first !== undefined || waterfall.slowest === i) && (
              <span className="col-span-3 text-[calc(10rem/14)] tabular-nums">
                {[
                  span.first !== undefined
                    ? t('First token {{duration}}', {
                        duration: formatTiming(span.first - span.start),
                      })
                    : undefined,
                  span.thought !== undefined && span.first !== undefined
                    ? t('Thinking {{duration}}', {
                        duration: formatTiming(span.thought - span.first),
                      })
                    : undefined,
                  span.first !== undefined
                    ? t('Generation {{duration}}', {
                        duration: formatTiming(span.end - (span.thought ?? span.first)),
                      })
                    : undefined,
                  waterfall.slowest === i ? t('Slowest step') : undefined,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}
