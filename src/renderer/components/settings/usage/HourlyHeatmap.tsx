import { formatTokens } from '@shared/usage/format';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';

const WEEKDAY_KEYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const HOURS = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0'));
const LEVELS = [
  'bg-primary/[0.07]',
  'bg-primary/20',
  'bg-primary/40',
  'bg-primary/60',
  'bg-primary/80',
  'bg-primary',
] as const;

function levelOf(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0;
  return 1 + Math.min(LEVELS.length - 2, Math.floor((value / max) * (LEVELS.length - 1)));
}

/** 7×24 活跃热力图，值为 tokens；颜色按与峰值的比例分 5 档。 */
export function HourlyHeatmap({ heatmap }: { heatmap: number[][] }) {
  const { t } = useI18n();
  const max = Math.max(0, ...heatmap.flat());
  return (
    <section className="min-w-0 border-t border-line pt-[20px]" data-slot="usage-heatmap">
      <h4 className="mb-[8px] text-[calc(14rem/14)] font-medium">{t('Activity by hour')}</h4>
      <div className="grid grid-cols-[calc(28rem/14)_minmax(0,1fr)] gap-x-2 gap-y-[3px]">
        {[1, 2, 3, 4, 5, 6, 0].map((weekday) => (
          <div key={WEEKDAY_KEYS[weekday]} className="contents">
            <span className="self-center text-[calc(11rem/14)] text-muted-foreground">
              {t(WEEKDAY_KEYS[weekday])}
            </span>
            <div className="grid grid-cols-24 gap-[3px]">
              {HOURS.map((label, hour) => (
                <span
                  key={label}
                  title={`${t(WEEKDAY_KEYS[weekday])} ${label}:00 · ${formatTokens(heatmap[weekday]?.[hour] ?? 0)}`}
                  className={cn(
                    'h-[calc(14rem/14)] rounded-[2px]',
                    LEVELS[levelOf(heatmap[weekday]?.[hour] ?? 0, max)]
                  )}
                />
              ))}
            </div>
          </div>
        ))}
        <span />
        <div className="grid grid-cols-8 text-[calc(11rem/14)] tabular-nums text-muted-foreground">
          {HOURS.filter((_, hour) => hour % 3 === 0).map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
      </div>
      <div className="mt-[8px] flex items-center justify-end gap-[6px] text-[calc(11rem/14)] text-muted-foreground">
        <span>{t('Less')}</span>
        {LEVELS.map((cls) => (
          <span key={cls} className={cn('inline-block size-2.5 rounded-[2px]', cls)} />
        ))}
        <span>{t('More')}</span>
      </div>
    </section>
  );
}
