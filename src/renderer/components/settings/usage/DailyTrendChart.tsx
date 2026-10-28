import { formatCost, formatTokens } from '@shared/usage/format';
import type { UsageDailyPoint } from '@shared/usage/types';
import * as React from 'react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';

type Metric = 'tokens' | 'cost';
type SeriesId = 'output' | 'input' | 'cache';

const W = 640;
const H = 150;
const PAD_TOP = 8;
const PAD_BOTTOM = 0;
const GAP_RATIO = 0.3;
/** 非零段至少 2px，避免输出相对缓存小两个数量级时被线性坐标压没 */
const MIN_SEG_PX = 2;

function dayLabel(day: string): string {
  const [, m, d] = day.split('-');
  return `${Number(m)}/${Number(d)}`;
}

const TOKEN_SERIES: Array<{ id: SeriesId; cls: string; swatch: string }> = [
  { id: 'output', cls: 'fill-primary', swatch: 'bg-primary' },
  { id: 'input', cls: 'fill-primary/55', swatch: 'bg-primary/55' },
  { id: 'cache', cls: 'fill-control', swatch: 'bg-control' },
];

/** 每日趋势：Token 模式堆叠 输出/输入/缓存；费用模式单柱。图例可点选系列。 */
export function DailyTrendChart({ daily }: { daily: UsageDailyPoint[] }) {
  const { t } = useI18n();
  const [metric, setMetric] = React.useState<Metric>('tokens');
  const [hover, setHover] = React.useState<number | null>(null);
  const [on, setOn] = React.useState<Record<SeriesId, boolean>>({
    output: true,
    input: true,
    cache: true,
  });

  const toggle = (id: SeriesId) => {
    setOn((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      if (!next.output && !next.input && !next.cache) return prev;
      return next;
    });
  };

  const values = daily.map((p) => {
    if (metric === 'cost') return p.cost ?? 0;
    return (on.output ? p.output : 0) + (on.input ? p.input : 0) + (on.cache ? p.cache : 0);
  });
  const max = Math.max(0, ...values);
  const n = Math.max(1, daily.length);
  const slot = W / n;
  const barW = Math.min(slot * (1 - GAP_RATIO), 64);
  const plotH = H - PAD_TOP - PAD_BOTTOM;
  const scale = (v: number) => (max > 0 ? (v / max) * plotH : 0);

  const labelEvery = Math.max(1, Math.ceil(n / 12));
  const hovered = hover !== null ? daily[hover] : null;

  return (
    <section className="min-w-0" data-slot="usage-trend">
      <div className="mb-[8px] flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-[calc(14rem/14)] font-medium">{t('Daily trend')}</h4>
        <MetricToggle value={metric} onChange={setMetric} />
      </div>
      <div className="relative">
        <div className="pointer-events-none absolute left-0 top-0 font-mono text-[calc(11rem/14)] text-muted-foreground">
          {metric === 'tokens' ? formatTokens(max) : formatCost(max > 0 ? max : null)}
        </div>
        {hovered && (
          <div className="pointer-events-none absolute right-0 top-0 rounded bg-popover px-2 py-1 font-mono text-[calc(11rem/14)] text-popover-foreground ring-1 ring-border">
            {hovered.day}
            {metric === 'tokens' ? (
              <>
                <div>
                  {t('Output')} {formatTokens(hovered.output)}
                </div>
                <div>
                  {t('Input')} {formatTokens(hovered.input)}
                </div>
                <div>
                  {t('Cache')} {formatTokens(hovered.cache)}
                </div>
              </>
            ) : (
              <> · {formatCost(hovered.cost)}</>
            )}
          </div>
        )}
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="mt-4 block h-[calc(150rem/14)] w-full border-b border-line"
          preserveAspectRatio="none"
          role="img"
          aria-label={t('Daily trend')}
          onMouseLeave={() => setHover(null)}
        >
          {daily.map((p, i) => {
            const x = i * slot + (slot - barW) / 2;
            const base = H - PAD_BOTTOM;
            const segments =
              metric === 'tokens'
                ? TOKEN_SERIES.filter((s) => on[s.id]).map((s) => ({
                    v: p[s.id],
                    cls: s.cls,
                  }))
                : [{ v: p.cost ?? 0, cls: 'fill-primary' }];
            let y = base;
            return (
              <g key={p.day} onMouseEnter={() => setHover(i)}>
                <rect x={x} y={PAD_TOP} width={barW} height={plotH} className="fill-transparent" />
                {segments.map((s) => {
                  const h = s.v > 0 ? Math.max(MIN_SEG_PX, scale(s.v)) : 0;
                  y -= h;
                  return (
                    <rect
                      key={s.cls}
                      x={x}
                      y={y}
                      width={barW}
                      height={h}
                      rx={1}
                      className={cn(s.cls, hover === i && 'opacity-80')}
                    />
                  );
                })}
              </g>
            );
          })}
        </svg>
        <div className="mt-[4px] flex text-[calc(11rem/14)] tabular-nums text-muted-foreground">
          {daily
            .filter((_, i) => i % labelEvery === 0)
            .map((p) => (
              <span key={p.day} className="min-w-0 flex-1 truncate text-center" title={p.day}>
                {dayLabel(p.day)}
              </span>
            ))}
        </div>
      </div>
      {metric === 'tokens' && (
        <div className="mt-[8px] flex flex-wrap items-center gap-x-[16px] gap-y-2 text-[calc(11rem/14)] text-muted-foreground">
          <Legend
            className="bg-primary"
            label={t('Output')}
            pressed={on.output}
            onClick={() => toggle('output')}
          />
          <Legend
            className="bg-primary/55"
            label={t('Input')}
            pressed={on.input}
            onClick={() => toggle('input')}
          />
          <Legend
            className="bg-control"
            label={t('Cache')}
            pressed={on.cache}
            onClick={() => toggle('cache')}
          />
        </div>
      )}
    </section>
  );
}

function Legend({
  className,
  label,
  pressed,
  onClick,
}: {
  className: string;
  label: string;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'flex items-center gap-1 rounded px-0.5 transition-opacity',
        pressed ? 'opacity-100' : 'opacity-40'
      )}
    >
      <span className={cn('inline-block h-2.5 w-2.5 rounded-sm', className)} />
      {label}
    </button>
  );
}

export function MetricToggle({
  value,
  onChange,
}: {
  value: Metric;
  onChange: (m: Metric) => void;
}) {
  const { t } = useI18n();
  const items: Array<{ id: Metric; label: string }> = [
    { id: 'tokens', label: t('Token') },
    { id: 'cost', label: t('Cost') },
  ];
  return (
    <div className="flex rounded-[6px] bg-muted p-0.5">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onChange(item.id)}
          className={cn(
            'rounded px-2 py-0.5 text-[calc(11rem/14)] transition-colors',
            value === item.id
              ? 'bg-background text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
